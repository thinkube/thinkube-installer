# Copyright Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""The installer page, the backend log and the setup log never show a secret from a run."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.api.playbook_stream as playbook_stream
from app.services.scrub import MASK

SUDO = "s3cret-sudo-pw"
TOKEN = "hf_abcdefghijklmnopqrstuvwxyz0123"

LEAKY_OUTPUT = (
    "TASK [Store the tokens]\n"
    f"ok: [tkamd1] => {{\"ansible_become_pass\": \"{SUDO}\"}}\n"
    f"changed: [tkamd1] => cmd: echo HF_TOKEN={TOKEN} >> ~/.env\n"
    f"fatal: [tkamd1]: FAILED! => {{\"msg\": \"login failed with {TOKEN}\"}}\n"
    "PLAY RECAP\n"
).encode()


class FakeStdout:
    def __init__(self, data):
        self._data = data

    async def read(self, size):
        chunk, self._data = self._data[:size], self._data[size:]
        return chunk


class FakeProcess:
    def __init__(self):
        self.stdout = FakeStdout(LEAKY_OUTPUT)
        self.returncode = None

    async def wait(self):
        self.returncode = 0
        return 0


def test_the_playbook_socket_sends_no_secret(monkeypatch, tmp_path):
    (tmp_path / "ansible" / "00_initial_setup").mkdir(parents=True)
    (tmp_path / "ansible" / "00_initial_setup" / "10_setup_ssh_keys.yaml").write_text("- hosts: all\n")
    env = playbook_stream.ansible_environment
    monkeypatch.setattr(env, "is_initialized", lambda: True)
    monkeypatch.setattr(env, "is_thinkube_cloned", lambda: True)
    monkeypatch.setattr(env, "get_thinkube_path", lambda: tmp_path)

    async def create_subprocess_exec(*args, **kwargs):
        return FakeProcess()

    monkeypatch.setattr(playbook_stream.asyncio, "create_subprocess_exec", create_subprocess_exec)
    logged = []
    monkeypatch.setattr(playbook_stream.logger, "info", lambda message, *a, **k: logged.append(str(message)))

    app = FastAPI()
    app.include_router(playbook_stream.router)
    received = []
    with TestClient(app).websocket_connect("/ws/playbook/setup-ssh-keys") as ws:
        ws.send_json({"extra_vars": {"ansible_become_pass": SUDO}, "environment": {"HF_TOKEN": TOKEN}})
        while True:
            message = ws.receive_json()
            received.append(message)
            if message["type"] in ("complete", "error"):
                break

    assert received[-1]["type"] == "complete", received[-1]
    for text in [str(m) for m in received] + logged:
        assert SUDO not in text and TOKEN not in text, text
    assert any(MASK in str(m) for m in received)
