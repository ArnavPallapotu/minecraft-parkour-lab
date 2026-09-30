"""Gymnasium adapter: Python learns; JavaScript advances Minecraft physics."""
from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import urlparse

import gymnasium as gym
import numpy as np

ROOT = Path(__file__).resolve().parent


class Bridge:
    def __init__(self):
        settings = json.loads((ROOT / ".bridge.json").read_text())
        url = urlparse(settings["url"])
        if url.hostname != "127.0.0.1":
            raise RuntimeError("This starter only connects to the local practice lab")
        self.connection = http.client.HTTPConnection(url.hostname, url.port, timeout=20)
        self.headers = {"Authorization": f"Bearer {settings['token']}", "Content-Type": "application/json"}

    def request(self, route, data=None):
        method = "GET" if data is None else "POST"
        self.connection.request(method, route, body=None if data is None else json.dumps(data), headers=self.headers)
        response = self.connection.getresponse()
        payload = json.loads(response.read())
        if response.status != 200:
            raise RuntimeError(payload.get("error", f"Lab returned {response.status}"))
        return payload

    def close(self):
        self.connection.close()


class ManagedLab:
    """Reuse a running lab, or temporarily start a simulator for training."""
    def __init__(self, backend="sim"):
        self.backend = backend
        self.process = None
        self.log = None
        self.bridge = None

    def __enter__(self):
        try:
            self.bridge = Bridge()
            status = self.bridge.request("/status")
        except (OSError, ValueError, http.client.HTTPException, RuntimeError):
            if self.bridge:
                self.bridge.close()
            self.bridge = None
            if self.backend == "live":
                raise RuntimeError("Start ./lab start (WSL/Linux) or Start-Lab.cmd (Windows) and wait for LIVE READY") from None
            (ROOT / "runs").mkdir(exist_ok=True)
            self.log = (ROOT / "runs" / "simulator-service.log").open("a", encoding="utf-8")
            node = ROOT / "runtime" / "node.exe" if os.name == "nt" else ROOT / "runtime" / "node" / "bin" / "node"
            executable = str(node) if node.exists() else "node"
            self.process = subprocess.Popen(
                [executable, "src/lab.js", "--sim-only"], cwd=ROOT,
                stdout=self.log, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    self.__exit__(None, None, None)
                    raise RuntimeError("Simulator failed to start; see runs/simulator-service.log")
                try:
                    candidate = Bridge()
                    status = candidate.request("/status")
                    self.bridge = candidate
                    break
                except (OSError, ValueError, http.client.HTTPException, RuntimeError):
                    if "candidate" in locals():
                        candidate.close()
                    time.sleep(0.15)
            else:
                self.__exit__(None, None, None)
                raise RuntimeError("Simulator startup timed out")
        if self.backend == "live" and not status["live"]:
            self.__exit__(None, None, None)
            raise RuntimeError("The lab is running but Minecraft is not ready. Restart ./lab start or Start-Lab.cmd with Minecraft enabled.")
        return self

    def __exit__(self, *_):
        if self.process and self.process.poll() is None:
            try:
                if self.bridge:
                    self.bridge.request("/shutdown", {})
                self.process.wait(timeout=20)
            except (OSError, RuntimeError, http.client.HTTPException, subprocess.TimeoutExpired):
                self.process.terminate()
                self.process.wait(timeout=10)
        if self.bridge:
            self.bridge.close()
        if self.log:
            self.log.close()


class ParkourEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, backend="sim", max_gap=2):
        super().__init__()
        if max_gap not in (1, 2, 3):
            raise ValueError("max_gap must be 1, 2, or 3")
        self.backend = backend
        self.max_gap = max_gap
        self.bridge = Bridge()
        details = self.bridge.request("/env", {"backend": backend})
        self.route = f"/env/{details['id']}"
        self.action_space = gym.spaces.Discrete(details["actions"])
        self.observation_space = gym.spaces.Box(-10, 10, shape=(details["observations"],), dtype=np.float32)
        self.closed = False

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        # Seeded variation discourages memorizing a single starting position.
        settings = {
            "gap": int(self.np_random.integers(1, self.max_gap + 1)),
            "startX": float(self.np_random.uniform(0.8, 2.3)),
        }
        settings.update(options or {})
        result = self.bridge.request(self.route + "/reset", settings)
        return np.asarray(result["observation"], dtype=np.float32), result["info"]

    def step(self, action):
        result = self.bridge.request(self.route + "/step", {"action": int(action)})
        return (
            np.asarray(result["observation"], dtype=np.float32), float(result["reward"]),
            bool(result["terminated"]), bool(result["truncated"]), result["info"],
        )

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            self.bridge.request(self.route + "/close", {})
        finally:
            self.bridge.close()
