from __future__ import annotations

import argparse
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class SubtitlePlayerHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".vtt": "text/vtt; charset=utf-8",
    }

    range = None

    def send_head(self):
        self.range = None
        path = self.translate_path(self.path)

        if os.path.isdir(path):
            return super().send_head()

        if not os.path.exists(path):
            self.send_error(404, "File not found")
            return None

        ctype = self.guess_type(path)

        try:
            file_handle = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        stat_result = os.fstat(file_handle.fileno())
        file_size = stat_result.st_size
        range_header = self.headers.get("Range")

        if range_header:
            parsed = self._parse_range_header(range_header, file_size)
            if parsed is None:
                file_handle.close()
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                return None

            start, end = parsed
            content_length = end - start + 1
            self.range = (start, end)

            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(content_length))
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Last-Modified", self.date_time_string(stat_result.st_mtime))
            self.end_headers()
            return file_handle

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(file_size))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Last-Modified", self.date_time_string(stat_result.st_mtime))
        self.end_headers()
        return file_handle

    def copyfile(self, source, outputfile):
        if self.range is None:
            super().copyfile(source, outputfile)
            return

        start, end = self.range
        remaining = end - start + 1
        source.seek(start)

        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    @staticmethod
    def _parse_range_header(range_header: str, file_size: int):
        if not range_header.startswith("bytes="):
            return None

        raw_range = range_header[len("bytes="):].strip()
        if "," in raw_range:
            return None

        start_text, _, end_text = raw_range.partition("-")

        if start_text == "" and end_text == "":
            return None

        try:
            if start_text == "":
                suffix_length = int(end_text)
                if suffix_length <= 0:
                    return None
                start = max(0, file_size - suffix_length)
                end = file_size - 1
            else:
                start = int(start_text)
                end = file_size - 1 if end_text == "" else int(end_text)
        except ValueError:
            return None

        if start < 0 or end < start or start >= file_size:
            return None

        end = min(end, file_size - 1)
        return start, end


def main() -> None:
    parser = argparse.ArgumentParser(description="Local server for subtitle player")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
    )
    args = parser.parse_args()

    root = args.root.resolve()
    handler = partial(SubtitlePlayerHandler, directory=str(root))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)

    print(f"Serving subtitle player at http://127.0.0.1:{args.port}/subtitle-player/index.html")
    print(f"Root directory: {root}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")


if __name__ == "__main__":
    main()
