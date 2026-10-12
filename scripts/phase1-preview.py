"""Local static preview with byte ranges, matching static-host audio seeking.
Run from the repository root: python scripts/phase1-preview.py
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from io import BytesIO
import argparse
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8765)
parser.add_argument('--baseline', action='store_true', help='Serve tracked HTML/CSS/JS from HEAD for before screenshots')
args = parser.parse_args()

class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.remaining = None
        file = Path(self.translate_path(self.path))
        if args.baseline and (file.suffix in ['.html', '.css', '.js'] or file.is_dir()):
            if file.is_dir(): file = file / 'index.html'
            relative = file.resolve().relative_to(Path.cwd().resolve()).as_posix()
            result = subprocess.run(['git', 'show', 'HEAD:'+relative], capture_output=True)
            if result.returncode == 0:
                self.send_response(200)
                self.send_header('Content-Type', self.guess_type(str(file)))
                self.send_header('Content-Length', str(len(result.stdout)))
                self.end_headers()
                return BytesIO(result.stdout)
        header = self.headers.get('Range', '')
        match = re.fullmatch(r'bytes=(\d+)-(\d*)', header)
        if match and file.is_file():
            total = file.stat().st_size
            start = int(match[1])
            end = min(int(match[2]) if match[2] else total - 1, total - 1)
            if start > end:
                self.send_error(416)
                return None
            self.send_response(206)
            self.send_header('Content-Type', self.guess_type(str(file)))
            self.send_header('Content-Range', f'bytes {start}-{end}/{total}')
            self.send_header('Content-Length', str(end-start+1))
            self.send_header('Accept-Ranges', 'bytes')
            self.end_headers()
            stream = file.open('rb')
            stream.seek(start)
            self.remaining = end-start+1
            return stream
        return super().send_head()

    def copyfile(self, source, output):
        try:
            if self.remaining is None:
                return super().copyfile(source, output)
            while self.remaining:
                chunk = source.read(min(self.remaining, 65536))
                if not chunk: break
                output.write(chunk)
                self.remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # Browsers cancel preloads and old ranges while seeking.

print(f'Local preview: http://127.0.0.1:{args.port}', flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
