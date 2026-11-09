#!/usr/bin/env python3
"""Serves the update mirror over HTTPS on 127.0.0.1:9443 for bryceflow itself.

WSL cannot reach this machine's own tailnet address (Tailscale runs on the Windows side),
so inside WSL the mirror hostname points at 127.0.0.1 (/etc/hosts) and this server answers
with the same Tailscale certificate. Port 9443 because WSL reserves 127.0.0.1:8443 here.
Tailscale Serve publishes the mirror on both :8443 and :9443 for other machines.
"""
import functools
import http.server
import os
import ssl
import sys

root = os.path.expanduser("~/.local/share/t3-fork-mirror")
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=f"{root}/www")
server = http.server.ThreadingHTTPServer(("127.0.0.1", 9443), handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(f"{root}/tls/mirror.crt", f"{root}/tls/mirror.key")
server.socket = context.wrap_socket(server.socket, server_side=True)
print("Serving the mirror on https://127.0.0.1:9443", file=sys.stderr, flush=True)
server.serve_forever()
