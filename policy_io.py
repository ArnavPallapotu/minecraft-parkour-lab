"""Load local PPO checkpoints or the portable, weights-only example policy."""
import gymnasium as gym
import numpy as np
from pathlib import Path
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.policies import ActorCriticPolicy

ROOT = Path(__file__).resolve().parent


def default_policy_path():
    latest = ROOT / "models" / "latest.zip"
    return latest if latest.is_file() else ROOT / "examples" / "first-policy.pt"


def load_policy(filename):
    filename = Path(filename)
    if filename.suffix == ".pt":
        # The public example contains tensors only, without an environment or local paths.
        policy = ActorCriticPolicy(
            gym.spaces.Box(-10, 10, shape=(12,), dtype=np.float32),
            gym.spaces.Discrete(5), lambda _: 0.0,
            net_arch={"pi": [64, 64], "vf": [64, 64]},
        )
        policy.load_state_dict(torch.load(filename, map_location="cpu", weights_only=True))
        policy.set_training_mode(False)
        return policy
    return PPO.load(filename, device="cpu")
