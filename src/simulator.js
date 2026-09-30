const { Vec3 } = require('vec3')
const { Physics, PlayerState } = require('prismarine-physics')
const { VERSION, course, controlsFor, Episode, TICKS_PER_ACTION } = require('./task')
const data = require('minecraft-data')(VERSION)
const Block = require('prismarine-block')(VERSION)

class Simulator {
  reset (options = {}) {
    const c = course(options)
    const cache = new Map()
    this.world = {
      getBlock: position => {
        const p = position.floored()
        const key = `${p.x},${p.y},${p.z}`
        if (!cache.has(key)) {
          const platform = p.y === c.floor && p.z >= -1 && p.z <= 1 &&
            ((p.x >= 0 && p.x < c.edge) || (p.x >= c.landing && p.x < c.end))
          const block = Block.fromStateId(platform ? data.blocksByName.stone.defaultState : 0, 0)
          block.position = p
          cache.set(key, block)
        }
        return cache.get(key)
      }
    }
    this.bot = {
      version: VERSION,
      entity: {
        position: new Vec3(c.startX, c.floor + 1, c.z), velocity: new Vec3(0, 0, 0),
        onGround: true, isInWater: false, isInLava: false, isInWeb: false,
        isCollidedHorizontally: false, isCollidedVertically: true, elytraFlying: false,
        yaw: -Math.PI / 2, pitch: 0, effects: {}
      },
      inventory: { slots: [] }, jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0
    }
    this.physics = Physics(data, this.world)
    this.episode = new Episode(c)
    return this.episode.result(this.bot, true)
  }

  step (action) {
    if (!this.episode || this.episode.done) throw new Error('Reset the environment before stepping')
    const controls = controlsFor(action)
    for (let i = 0; i < TICKS_PER_ACTION; i++) {
      this.physics.simulatePlayer(new PlayerState(this.bot, controls), this.world).apply(this.bot)
    }
    return this.episode.result(this.bot)
  }

  close () {}
}

module.exports = { Simulator }
