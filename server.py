"""把两路 RTSP 转成浏览器可播放的 MJPEG，并提供监控页面。"""
from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
HOST = "0.0.0.0"
PORT = 8080
STREAMS = {
    "vis": "rtsp://192.168.137.100:3500/video11-live/video11",
    "ir": "rtsp://192.168.137.100:3501/video0-live/video0",
}


_FFMPEG: str | None = None
_FFMPEG_LOOKED = False


def find_ffmpeg() -> str | None:
    global _FFMPEG, _FFMPEG_LOOKED
    if _FFMPEG_LOOKED:
        return _FFMPEG
    _FFMPEG_LOOKED = True
    found = shutil.which("ffmpeg")
    if not found:
        local = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages")
        if os.path.isdir(local):
            for dirpath, _, files in os.walk(local):
                if "ffmpeg.exe" in files:
                    found = os.path.join(dirpath, "ffmpeg.exe")
                    break
    _FFMPEG = found
    return found


class Relay:
    def __init__(self, name: str, url: str) -> None:
        self.name = name
        self.url = url
        self.clients = 0
        self.seq = 0
        self.frame = b""
        self.state = "idle"
        self.error = ""
        self.fps = 0.0
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._stop = False
        self._worker: threading.Thread | None = None
        self._proc: subprocess.Popen | None = None

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "url": self.url,
                "state": self.state,
                "fps": round(self.fps, 1),
                "error": self.error,
            }

    def acquire(self) -> None:
        with self._lock:
            self.clients += 1
            self._stop = False
            if self._worker is None or not self._worker.is_alive():
                self.state = "connecting"
                self.error = ""
                self._worker = threading.Thread(target=self._run, name=f"relay-{self.name}", daemon=True)
                self._worker.start()

    def release(self) -> None:
        with self._lock:
            self.clients = max(0, self.clients - 1)
            if self.clients == 0:
                self._stop = True
                proc = self._proc
            else:
                proc = None
        if proc is not None:
            _stop_proc(proc)

    def wait_frame(self, seen: int, timeout: float = 5.0):
        deadline = time.time() + timeout
        with self._cond:
            while self.seq == seen and self.clients > 0:
                remaining = deadline - time.time()
                if remaining <= 0:
                    return seen, self.frame
                self._cond.wait(remaining)
            return self.seq, self.frame

    def _run(self) -> None:
        ffmpeg = find_ffmpeg()
        while True:
            with self._lock:
                if self._stop or self.clients <= 0:
                    self.state = "idle"
                    self.fps = 0
                    return
            if not ffmpeg:
                with self._lock:
                    self.state = "error"
                    self.error = "未找到 ffmpeg，无法转发 RTSP"
                    self._cond.notify_all()
                time.sleep(1)
                continue
            proc = subprocess.Popen(
                [
                    ffmpeg, "-hide_banner", "-loglevel", "error",
                    "-rtsp_transport", "tcp",
                    "-timeout", "8000000",
                    "-i", self.url,
                    "-an",
                    "-vf", "fps=15",
                    "-q:v", "6",
                    "-f", "image2pipe",
                    "-vcodec", "mjpeg",
                    "pipe:1",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            with self._lock:
                self._proc = proc
                self.state = "connecting"
            errors: list[str] = []
            threading.Thread(target=_drain_err, args=(proc, errors), daemon=True).start()
            self._read_frames(proc)
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                _stop_proc(proc)
            message = " ".join(errors).strip() or "视频流中断"
            with self._lock:
                self._proc = None
                self.fps = 0
                if self._stop or self.clients <= 0:
                    self.state = "idle"
                    self.error = ""
                    return
                self.state = "error"
                self.error = message[-240:]
                self._cond.notify_all()
            time.sleep(2)

    def _read_frames(self, proc: subprocess.Popen) -> None:
        buf = b""
        stamps: list[float] = []
        assert proc.stdout is not None
        while True:
            chunk = proc.stdout.read(16384)
            if not chunk:
                return
            buf += chunk
            if len(buf) > 8 * 1024 * 1024:
                buf = buf[-1024 * 1024 :]
            while True:
                start = buf.find(b"\xff\xd8")
                if start < 0:
                    buf = b""
                    break
                end = buf.find(b"\xff\xd9", start + 2)
                if end < 0:
                    buf = buf[start:]
                    break
                frame = buf[start : end + 2]
                buf = buf[end + 2 :]
                now = time.time()
                stamps.append(now)
                stamps = [item for item in stamps if now - item <= 1]
                with self._cond:
                    if self._stop:
                        _stop_proc(proc)
                        return
                    self.seq += 1
                    self.frame = frame
                    self.state = "playing"
                    self.error = ""
                    self.fps = float(len(stamps))
                    self._cond.notify_all()


def _drain_err(proc: subprocess.Popen, errors: list[str]) -> None:
    if proc.stderr is None:
        return
    for line in proc.stderr:
        text = line.decode("utf-8", "ignore").strip()
        if text:
            errors.append(text)
            del errors[:-8]


def _stop_proc(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=1)
    except subprocess.TimeoutExpired:
        proc.kill()


RELAYS = {name: Relay(name, url) for name, url in STREAMS.items()}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        if str(args[0]).startswith("GET /stream/"):
            return
        super().log_message(fmt, *args)

    def do_GET(self) -> None:
        path = unquote(urlparse(self.path).path)
        if path in ("/stream/vis", "/stream/ir"):
            self._stream(path.rsplit("/", 1)[-1])
            return
        if path == "/api/status":
            self._status()
            return
        self._file(path)

    def _status(self) -> None:
        import json
        body = json.dumps({name: relay.snapshot() for name, relay in RELAYS.items()}, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _stream(self, name: str) -> None:
        relay = RELAYS[name]
        relay.acquire()
        try:
            self.protocol_version = "HTTP/1.0"
            self.close_connection = True
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.send_header("Pragma", "no-cache")
            self.end_headers()
            seen = 0
            while True:
                seen, frame = relay.wait_frame(seen)
                if not frame:
                    continue
                header = (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(frame)).encode("ascii") + b"\r\n\r\n"
                )
                self.wfile.write(header)
                self.wfile.write(frame)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError):
            pass
        except OSError:
            pass
        finally:
            relay.release()

    def _file(self, path: str) -> None:
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (ROOT / relative).resolve()
        if not str(target).startswith(str(ROOT)) or not target.is_file() or target.suffix not in {".html", ".css", ".js", ".svg", ".png", ".ico"}:
            body = "未找到页面".encode("utf-8")
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        data = target.read_bytes()
        kind = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
        }[target.suffix]
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"监控台 http://127.0.0.1:{PORT}")
    print(f"可见光 {STREAMS['vis']}")
    print(f"红外   {STREAMS['ir']}")
    if not find_ffmpeg():
        print("未找到 ffmpeg，页面可以打开，但还不能转发 RTSP。")
    server.serve_forever()


if __name__ == "__main__":
    main()
