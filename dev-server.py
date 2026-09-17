#!/usr/bin/env python3
"""Serwer podglądu FuturePilot: pliki statyczne bez pamięci podręcznej (zawsze świeże moduły JS).
Użycie: python3 dev-server.py [port]   — domyślnie 8167"""
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".webmanifest": "application/manifest+json"}
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()
    def log_message(self, fmt, *args):
        pass

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8167
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    http.server.ThreadingHTTPServer(("0.0.0.0", port), NoCache).serve_forever()
