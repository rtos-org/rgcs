#!/usr/bin/env python3
"""Dev-only MAVLink UDP relay for several SITL vehicles behind one rgcs-server link.

rgcs-server's `udpin` link answers only the last peer it heard, so three SITLs sending to one port
would get each other's replies. This relay listens for the vehicles on VEHICLE_PORT (each SITL runs
with `--serial0 udpclient:127.0.0.1:VEHICLE_PORT`), forwards everything to the server's udpin port
from a single socket, and sends whatever the server says to every vehicle — each autopilot ignores
messages addressed to another system (what mavlink-router does for broadcast traffic).

    python3 -I scripts/mav-relay.py [VEHICLE_PORT=14550] [SERVER_PORT=14551]
"""
import selectors
import socket
import sys

HOST = "127.0.0.1"


def main() -> None:
    vehicle_port = int(sys.argv[1]) if len(sys.argv) > 1 else 14550
    server_port = int(sys.argv[2]) if len(sys.argv) > 2 else 14551
    vehicles = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    vehicles.bind((HOST, vehicle_port))
    server = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    server.bind((HOST, 0))
    peers: set = set()
    sel = selectors.DefaultSelector()
    sel.register(vehicles, selectors.EVENT_READ, "vehicle")
    sel.register(server, selectors.EVENT_READ, "server")
    print(f"[relay] vehicles -> udp:{vehicle_port}, server <- udp:{server_port}", flush=True)
    while True:
        for key, _ in sel.select():
            data, addr = key.fileobj.recvfrom(65535)
            if key.data == "vehicle":
                if addr not in peers:
                    peers.add(addr)
                    print(f"[relay] vehicle at {addr[0]}:{addr[1]} ({len(peers)} total)", flush=True)
                server.sendto(data, (HOST, server_port))
            else:
                for peer in peers:
                    vehicles.sendto(data, peer)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
