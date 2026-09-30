"""Train an actual PPO neural network. No jump timings are scripted here."""
from __future__ import annotations

import argparse
from collections import deque
from datetime import datetime
import json
import os
from pathlib import Path
import time

# Keep library caches inside this project.
os.environ.setdefault("MPLCONFIGDIR", str(Path(__file__).resolve().parent / "runs" / ".matplotlib"))

import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.monitor import Monitor

from parkour_env import ROOT, ManagedLab, ParkourEnv


def evaluate(env, model, episodes, seed=100000):
    outcomes = []
    random = np.random.default_rng(seed)
    for episode in range(episodes):
        obs, info = env.reset(seed=seed + episode)
        total = 0.0
        done = False
        while not done:
            action = int(random.integers(env.action_space.n)) if model is None else int(model.predict(obs, deterministic=True)[0])
            obs, reward, terminated, truncated, info = env.step(action)
            total += reward
            done = terminated or truncated
        outcomes.append({**info, "reward": total})
    return {
        "episodes": episodes,
        "successes": sum(int(row["is_success"]) for row in outcomes),
        "success_rate": float(np.mean([row["is_success"] for row in outcomes])),
        "mean_reward": float(np.mean([row["reward"] for row in outcomes])),
        "outcomes": outcomes,
    }


class Progress(BaseCallback):
    def __init__(self, folder):
        super().__init__()
        self.folder = folder
        self.recent = deque(maxlen=100)
        self.started = time.monotonic()

    def _on_step(self):
        for done, info in zip(self.locals["dones"], self.locals["infos"]):
            if done:
                self.recent.append(bool(info.get("is_success", False)))
        if self.n_calls % 2048 == 0:
            rate = np.mean(self.recent) if self.recent else 0
            print(f"Steps: {self.num_timesteps:,} | recent training landings: {rate:.0%} | elapsed: {time.monotonic() - self.started:.0f}s", flush=True)
        if self.n_calls % 4096 == 0:
            self.model.save(self.folder / "checkpoint")
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=20000, help="Additional decisions to train; rounded up to a complete PPO rollout")
    parser.add_argument("--backend", choices=["sim", "live"], default="sim")
    parser.add_argument("--max-gap", type=int, choices=[1, 2, 3], default=2)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--resume", type=Path, help="Continue a saved .zip policy")
    parser.add_argument("--eval-episodes", type=int, default=100)
    args = parser.parse_args()
    if args.steps < 1 or args.eval_episodes < 1:
        parser.error("steps and eval-episodes must be positive")
    torch.set_num_threads(1)
    folder = ROOT / "runs" / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    folder.mkdir(parents=True)
    (ROOT / "models").mkdir(exist_ok=True)
    print(f"Training PPO: two 64-neuron hidden layers; backend={args.backend}; CPU.", flush=True)
    print("Observations: position, velocity, landing geometry. Actions: coast, walk, sprint, and jumps.", flush=True)
    print(f"Results folder: {folder}", flush=True)
    if args.backend == "live":
        print("Live mode runs at game speed. Leave Minecraft and the lab open.", flush=True)
    with ManagedLab(args.backend):
        raw = ParkourEnv(args.backend, args.max_gap)
        env = Monitor(raw, str(folder / "episodes"), info_keywords=("is_success", "gap"))
        try:
            print("Measuring a random-action baseline on held-out starting conditions...", flush=True)
            baseline = evaluate(raw, None, args.eval_episodes)
            print(f"Random baseline: {baseline['success_rate']:.1%}", flush=True)
            if args.resume:
                model = PPO.load(args.resume, env=env, device="cpu")
                model.set_random_seed(args.seed)
            else:
                model = PPO(
                    "MlpPolicy", env, learning_rate=3e-4, n_steps=1024, batch_size=64,
                    n_epochs=10, gamma=0.99, ent_coef=0.01, seed=args.seed, device="cpu",
                    policy_kwargs={"net_arch": {"pi": [64, 64], "vf": [64, 64]}}, verbose=0,
                )
            interrupted = False
            start = time.monotonic()
            try:
                model.learn(total_timesteps=args.steps, callback=Progress(folder), reset_num_timesteps=not bool(args.resume))
            except KeyboardInterrupt:
                interrupted = True
                print("Stopping and saving the current policy...", flush=True)
            model.save(folder / "policy")
            model.save(ROOT / "models" / "latest")
            summary = {
                "algorithm": "PPO", "backend": args.backend, "minecraft_version": "1.21.11",
                "seed": args.seed, "max_gap": args.max_gap, "requested_steps": args.steps,
                "total_model_steps": model.num_timesteps, "training_seconds": time.monotonic() - start,
                "interrupted": interrupted, "random_baseline": baseline,
                "model": (folder / "policy.zip").relative_to(ROOT).as_posix(),
            }
            if not interrupted:
                print("Evaluating the trained model on the same held-out test cases...", flush=True)
                trained = evaluate(raw, model, args.eval_episodes)
                summary["trained"] = trained
                print(f"Trained policy: {trained['successes']}/{trained['episodes']} landed ({trained['success_rate']:.1%}).", flush=True)
            (folder / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
            (ROOT / "models" / "latest-run.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
            print("Saved models/latest.zip. Each run also keeps its own model and results.", flush=True)
            if args.backend == "sim":
                print("These are SIMULATOR results. Use ./lab watch or Watch.cmd to measure transfer to Minecraft.", flush=True)
        finally:
            env.close()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError) as error:
        raise SystemExit(f"Parkour Lab: {error}") from error
