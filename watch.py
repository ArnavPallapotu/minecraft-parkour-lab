"""Run a saved neural policy, with no further training."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import time

os.environ.setdefault("MPLCONFIGDIR", str(Path(__file__).resolve().parent / "runs" / ".matplotlib"))

import torch

from parkour_env import ROOT, ManagedLab, ParkourEnv
from policy_io import default_policy_path, load_policy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=default_policy_path())
    parser.add_argument("--backend", choices=["sim", "live"], default="live")
    parser.add_argument("--episodes", type=int, default=10)
    parser.add_argument("--max-gap", type=int, choices=[1, 2, 3], default=2)
    parser.add_argument("--seed", type=int, default=200000)
    args = parser.parse_args()
    if args.episodes < 1:
        parser.error("episodes must be positive")
    if not args.model.is_file():
        raise SystemExit("No saved model found. Run ./lab train or Train.cmd first.")
    torch.set_num_threads(1)
    model = load_policy(args.model)
    outcomes = []
    with ManagedLab(args.backend):
        env = ParkourEnv(args.backend, args.max_gap)
        try:
            for episode in range(args.episodes):
                obs, info = env.reset(seed=args.seed + episode)
                print(f"Attempt {episode + 1}/{args.episodes}: gap={info['gap']}", flush=True)
                done = False
                while not done:
                    action, _ = model.predict(obs, deterministic=True)
                    obs, reward, terminated, truncated, info = env.step(action)
                    done = terminated or truncated
                outcomes.append(info)
                print(f"  {info['outcome'].upper()} after {info['steps']} decisions", flush=True)
                if args.backend == "live":
                    time.sleep(1)
        finally:
            env.close()
    successes = sum(int(info["is_success"]) for info in outcomes)
    report = {"backend": args.backend, "model": str(args.model), "seed": args.seed, "successes": successes, "episodes": len(outcomes), "outcomes": outcomes}
    folder = ROOT / "runs"
    folder.mkdir(exist_ok=True)
    output = folder / f"evaluation-{args.backend}-{datetime.now():%Y%m%d-%H%M%S}.json"
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"{args.backend.upper()} result: {successes}/{len(outcomes)} landed. Saved {output.name}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Stopped watching.")
    except (RuntimeError, OSError) as error:
        raise SystemExit(f"Parkour Lab: {error}") from error
