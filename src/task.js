// Both the simulator and real Minecraft use this task, action set, and reward.
const VERSION = '1.21.11'
const ACTION_NAMES = ['coast', 'walk', 'sprint', 'walk+jump', 'sprint+jump']
const OBS_NAMES = [
  'distance_to_edge', 'distance_to_landing', 'distance_to_landing_end',
  'height_above_platform', 'sideways_offset', 'velocity_x', 'velocity_y',
  'velocity_z', 'on_ground', 'jump_cooldown', 'gap_width', 'time_remaining'
]
const TICKS_PER_ACTION = 2
const MAX_STEPS = 80

function course (options = {}) {
  const gap = options.gap ?? 1
  const startX = options.startX ?? 1.5
  if (!Number.isInteger(gap) || gap < 1 || gap > 3) throw new Error('gap must be 1, 2, or 3')
  if (!Number.isFinite(startX) || startX < 0.8 || startX > 2.3) throw new Error('startX must be between 0.8 and 2.3')
  return { gap, startX, edge: 5, landing: 5 + gap, end: 11 + gap, floor: 100, z: 0.5 }
}

function controlsFor (action) {
  if (!Number.isInteger(action) || action < 0 || action >= ACTION_NAMES.length) throw new Error('Invalid action')
  return {
    forward: action > 0, back: false, left: false, right: false,
    jump: action === 3 || action === 4, sprint: action === 2 || action === 4, sneak: false
  }
}

function observe (bot, c, steps) {
  const p = bot.entity.position
  const v = bot.entity.velocity
  const values = [
    (c.edge - p.x) / 8, (c.landing - p.x) / 8, (c.end - p.x) / 16,
    (p.y - c.floor - 1) / 4, (p.z - c.z) / 4,
    v.x / 0.4, v.y / 0.6, v.z / 0.4,
    bot.entity.onGround ? 1 : 0, (bot.jumpTicks || 0) / 10,
    c.gap / 4, Math.max(0, 1 - steps / MAX_STEPS)
  ]
  if (values.some(x => !Number.isFinite(x))) throw new Error('Non-finite observation')
  return values.map(x => Math.max(-10, Math.min(10, x)))
}

class Episode {
  constructor (c) {
    this.course = c
    this.steps = 0
    this.maxX = c.startX
    this.done = false
  }

  result (bot, initial = false) {
    const c = this.course
    const p = bot.entity.position
    if (!initial) this.steps++
    const success = bot.entity.onGround && Math.abs(p.y - c.floor - 1) < 0.08 &&
      p.x >= c.landing + 0.35 && p.x <= c.end - 0.35 && Math.abs(p.z - c.z) < 1.15
    const fallen = p.y < c.floor + 0.2 || p.x < -1 || p.x > c.end + 1 || Math.abs(p.z - c.z) > 2.5
    const terminated = !initial && (success || fallen)
    const truncated = !initial && !terminated && this.steps >= MAX_STEPS
    // Only reward NEW forward progress. Moving back and forth cannot farm rewards.
    const newMax = Math.max(this.maxX, Math.min(p.x, c.landing + 0.5))
    let reward = initial ? 0 : (newMax - this.maxX) * 0.25 - 0.01
    this.maxX = newMax
    if (terminated) reward += success ? 10 : -5
    if (truncated) reward -= 2
    this.done = terminated || truncated
    return {
      observation: observe(bot, c, this.steps), reward, terminated, truncated,
      info: {
        is_success: !initial && success,
        outcome: terminated ? (success ? 'landed' : 'fell') : truncated ? 'timeout' : 'running',
        gap: c.gap, start_x: c.startX, steps: this.steps,
        position: { x: p.x, y: p.y, z: p.z }
      }
    }
  }
}

module.exports = { VERSION, ACTION_NAMES, OBS_NAMES, TICKS_PER_ACTION, MAX_STEPS, course, controlsFor, Episode }
