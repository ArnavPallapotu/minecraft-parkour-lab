# Minecraft Parkour Learning Lab

Train a **PPO neural network** to walk, sprint, and jump, then watch it control a bot in **Minecraft Java 1.21.11**.

The first task is a straight jump across a gap. A fast Minecraft physics simulator provides training experience; Mineflayer connects the learned actions to the real game. Your Jetson and Arduino are not needed for this stage.

## Start in WSL

Keep Minecraft running on Windows. Run the bot, simulator, training, and practice server inside WSL.

```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/ArnavPallapotu/minecraft-parkour-lab.git
cd minecraft-parkour-lab
chmod +x lab
./lab setup
./lab train
```

Setup requires **Python 3.10–3.13 with venv support**; Python 3.12 is recommended. It installs packages into `.venv`. If Node 22 or newer is unavailable, setup downloads an official Node 24 LTS runtime into `runtime/` and verifies its checksum. It also downloads and verifies the matching Minecraft server. It does not accept Minecraft's EULA or start the server.

On Ubuntu, install missing prerequisites with:

```bash
sudo apt update
sudo apt install git python3 python3-venv openjdk-21-jre-headless
```

Java 21 is needed only for the live server. For simulator training alone, use `./lab setup --skip-server`.

Clone into your Linux home folder as above. A Windows Python environment cannot be reused in WSL. [Microsoft recommends storing Linux projects in the WSL filesystem](https://learn.microsoft.com/en-us/windows/wsl/filesystems).

## Train your model

```bash
./lab train
./lab train --steps 50000
./lab train --resume models/latest.zip --steps 20000
./lab train --resume models/latest.zip --max-gap 3 --steps 50000
```

Training starts a simulator automatically, measures a random-action baseline, trains the neural network, and evaluates it on the same seeded test cases. The default requests 20,000 decisions, rounded to a full PPO rollout (20,480).

| Output | Contents |
|---|---|
| `models/latest.zip` | Latest model; use for watching or continued training. |
| `runs/<timestamp>/policy.zip` | That run's model, retained when you train again. |
| `runs/<timestamp>/summary.json` | Parameters, evaluation results, and timing. |
| `runs/<timestamp>/episodes.monitor.csv` | Training rewards, episode lengths, and successes. |

Press **Ctrl+C once** during training to save the current weights and stop. Let it finish saving. The policy and value networks each have two hidden layers of 64 neurons. This small model runs on CPU; a GPU is not required.

## Watch in Minecraft

In your first WSL terminal:

```bash
./lab start
```

On the first run, read the linked [Minecraft EULA](https://www.minecraft.net/en-us/eula), then type `AGREE` if you accept. Wait for **LIVE READY** and leave that terminal open.

In Minecraft **Java 1.21.11 on Windows**, choose **Multiplayer → Direct Connection** and enter **127.0.0.1:25575**. You join in Creative mode near the course; fly above it to watch without colliding with the bot.

In a second WSL terminal, from this repository:

```bash
./lab watch
```

This runs ten attempts using your latest model. If you have not trained yet, it uses the included example in `examples/first-policy.pt`. Reports are saved in `runs/evaluation-live-*.json`.

The practice server binds to loopback only and uses local offline identities for your player and the bot. No second account is needed. Windows normally reaches a WSL server through localhost; see [Microsoft's WSL networking guide](https://learn.microsoft.com/en-us/windows/wsl/networking) if your configuration differs. Keep the server bound to loopback.

Stop the lab with **Ctrl+C** so it can save and stop the practice world. That world lives under `server/parkour-world`.

## Try the included model

After setup, you can evaluate the sample without starting Minecraft:

```bash
./lab watch --backend sim --model examples/first-policy.pt --episodes 100
```

The sample learned simple one- and two-block gaps. It landed 100/100 attempts in each of two simulator evaluations, compared with 61/100 for random actions. These are **simulator results**; live Minecraft behavior remains unverified. [Read the results and limitations](RESULTS.md).

The `.pt` example contains portable network weights only. Your own `.zip` checkpoints also preserve PPO state for `--resume`.

## What the model learns

- **Observations:** distances to the edge and landing, height, sideways position, velocity, grounded state, jump cooldown, gap width, and time remaining.
- **Actions:** coast, walk, sprint, walk+jump, or sprint+jump. Each decision lasts two physics ticks.
- **Reward:** a small reward for new forward progress, a small time cost, +10 for landing, -5 for falling, and -2 for timing out.
- **Variation:** gap widths and starting positions vary between attempts.

The environment supplies a straight heading and resets between attempts. The model chooses movement and jumping during each attempt. It does not yet learn turning, narrow landings, corner jumps, head-hitters, or route planning. It reads game state rather than screenshots.

The simulator and game share action and reward code, but timing and server corrections can still affect transfer. After measuring live performance, you can fine-tune at game speed:

```bash
./lab train --backend live --resume models/latest.zip --steps 4096 --eval-episodes 10
```

This is substantially slower. Use one live trainer or watcher at a time.

## Find your way around

| File | Purpose |
|---|---|
| `train.py` | Create, train, evaluate, and save PPO models. |
| `parkour_env.py` | Gymnasium interface between Python and JavaScript. |
| `src/task.js` | Actions, observations, course geometry, and rewards. Start experimenting here. |
| `src/simulator.js` | Fast physics simulation. |
| `src/minecraft.js` | Mineflayer bot and practice-server control. |
| `watch.py`, `policy_io.py` | Load and run learned policies. |
| `lab`, `scripts/` | WSL setup and launch commands. |
| `examples/` | Sample weights and evaluation data. |
| `test/` | Simulator and Python-interface tests. |

```bash
./lab test
```

GitHub Actions also runs the simulator tests on Linux. Local WSL execution could not be verified from the initial Windows development session; check the Actions result and run `./lab test` in your WSL clone.

Good first experiment: change the time penalty in `src/task.js`, restart any running lab, train again, and compare landing success and episode length. Changing observations or action definitions generally requires training a fresh model.

## Troubleshooting

- **Missing venv support:** install `python3-venv`, then rerun setup.
- **Windows environment detected:** clone into `~/projects` in WSL and run setup there.
- **Node unavailable:** setup installs a local Node runtime; `./lab` selects it automatically.
- **Live Minecraft unavailable:** wait for `LIVE READY`; simulator-only mode does not start a server.
- **Connection refused:** verify Java 1.21.11, port `25575`, and that the WSL lab is running. Check localhost forwarding in Microsoft's guide above.
- **Port already in use:** stop the previous lab. Minecraft uses 25575; the training bridge uses 8765.
- **The policy fails in the game:** retain the evaluation report. Its `server_corrections` field can help diagnose differences from simulation.
- **Server startup fails:** check `server/launcher.log` and `java -version` inside WSL.

Native Windows launchers are also included; see [Windows instructions](docs/windows.md).

## Dependencies

[Mineflayer](https://github.com/PrismarineJS/mineflayer), [Prismarine Physics](https://github.com/PrismarineJS/prismarine-physics), [Stable-Baselines3 PPO](https://stable-baselines3.readthedocs.io/en/v2.7.1/modules/ppo.html), [PyTorch](https://pytorch.org/), and [Gymnasium](https://gymnasium.farama.org/).

Minecraft's server is downloaded from Mojang during setup and is not redistributed here. Worlds, installed dependencies, local checkpoints, bridge credentials, and run logs are ignored by Git. Dependency versions are recorded in `package-lock.json` and `requirements.txt`; `requirements-lock.txt` records the initial Windows environment for reference.
