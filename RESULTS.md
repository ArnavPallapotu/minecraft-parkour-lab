# First training run

The included `examples/first-policy.pt` contains the weights of a PPO neural policy trained from scratch during the initial development run. Local training produces resumable checkpoints in `models/latest.zip`.

| Measurement | Result |
|---|---:|
| Training decisions | 20,480 |
| Time spent in the training loop | 62.6 seconds |
| Random-action baseline, 100 seeded simulator attempts | 61 landed |
| Trained policy, same 100 test cases | 100 landed |
| Trained policy, another 100 attempts with new seeds | 100 landed |
| Live Minecraft evaluation | Pending EULA acceptance and server testing |

The task is a straight jump across a one- or two-block gap, with starting position randomized between 0.8 and 2.3 blocks along the starting platform. The environment supplies the heading. These measurements do not demonstrate complex parkour, steering, or performance in the real game.

Training used seed 7. The first evaluation used seeds starting at 100000; the additional evaluation used seeds starting at 300000. Tests use the same course distribution as training, with different random starting conditions. More difficult geometries are not covered by this result.

The public evaluation records are `examples/first-training.json` and `examples/independent-evaluation.json`. The original local checkpoints and episode logs are excluded from Git. New runs log training episodes alone in their episode CSV.

Verification completed: five simulator behavior tests, three Python/Gymnasium integration checks, model save/load and independent evaluation, and Java 21 loading the official Minecraft 1.21.11 server's help command. The actual Minecraft server has not yet been started.
