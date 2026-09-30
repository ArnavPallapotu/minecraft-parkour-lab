const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const mineflayer = require('mineflayer')
const { VERSION, course, controlsFor, Episode, TICKS_PER_ACTION } = require('./task')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

class Minecraft {
  constructor (root) {
    this.root = root
    this.ready = false
    this.bot = null
    this.closing = false
    this.resetting = false
    this.warnings = 0
  }

  command (text) {
    if (!this.server || this.server.exitCode !== null) throw new Error('Minecraft server is not running')
    this.server.stdin.write(`${text}\n`)
  }

  async start () {
    const folder = path.join(this.root, 'server')
    if (!fs.existsSync(path.join(folder, 'server.jar'))) throw new Error('Missing server/server.jar. Run setup first.')
    const log = fs.createWriteStream(path.join(folder, 'launcher.log'), { flags: 'a' })
    this.server = spawn('java', ['-Xms512M', '-Xmx2G', '-jar', 'server.jar', 'nogui'], {
      cwd: folder, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    })
    this.server.stdout.pipe(log, { end: false })
    this.server.stderr.pipe(log, { end: false })
    this.server.once('exit', () => { this.ready = false; log.end() })
    console.log('Starting Minecraft 1.21.11; the first world may take a minute...')
    const lines = createInterface({ input: this.server.stdout })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out. See server/launcher.log.')), 180000)
      this.server.once('error', e => { clearTimeout(timer); reject(e) })
      this.server.once('exit', code => { clearTimeout(timer); reject(new Error(`Minecraft exited (${code}). See server/launcher.log.`)) })
      lines.on('line', line => {
        if (line.includes('Done (')) { clearTimeout(timer); resolve() }
        const joined = line.match(/: ([A-Za-z0-9_]{1,16}) joined the game$/)
        if (joined && joined[1] !== 'ParkourBot') {
          const user = joined[1]
          this.command(`gamemode creative ${user}`)
          this.command(`tp ${user} 3 104 -5 0 30`)
          console.log(`${user} joined. Fly over the course to watch ParkourBot.`)
        }
      })
    })
    for (const command of [
      'gamerule minecraft:advance_time false', 'time set day',
      'gamerule minecraft:advance_weather false', 'weather clear',
      'gamerule minecraft:spawn_mobs false', 'gamerule minecraft:fall_damage false',
      'gamerule minecraft:send_command_feedback false',
      'setworldspawn 2 101 0', 'forceload add -16 -16 32 16'
    ]) this.command(command)

    // Explicitly scoped to this project's newly generated practice world.
    this.buildCourse(course())
    this.command('fill -4 98 -6 18 98 -4 smooth_stone')
    await sleep(500)
    this.bot = mineflayer.createBot({ host: '127.0.0.1', port: 25575, username: 'ParkourBot', auth: 'offline', version: VERSION })
    this.bot.on('error', e => console.error('Bot:', e.message))
    this.bot.on('kicked', reason => console.error('Bot disconnected:', String(reason)))
    this.bot.on('end', () => { this.ready = false })
    this.bot.on('forcedMove', () => { if (this.ready && !this.resetting) this.warnings++ })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Bot did not join within 45 seconds.')), 45000)
      this.bot.once('spawn', () => { clearTimeout(timer); resolve() })
      this.bot.once('error', e => { clearTimeout(timer); reject(e) })
    })
    this.command('gamemode adventure ParkourBot')
    this.command('effect give ParkourBot minecraft:saturation infinite 0 true')
    await this.bot.waitForChunksToLoad()
    this.ready = true
    await this.reset({ gap: 1, startX: 1.5 })
    console.log('LIVE READY. In Minecraft 1.21.11: Multiplayer > Direct Connection > 127.0.0.1:25575')
  }

  buildCourse (c) {
    this.command('fill -1 99 -2 16 104 2 air')
    this.command(`fill 0 ${c.floor} -1 4 ${c.floor} 1 stone`)
    this.command(`fill ${c.landing} ${c.floor} -1 ${c.end - 1} ${c.floor} 1 stone`)
  }

  async ticks (count) {
    const bot = this.bot
    await new Promise((resolve, reject) => {
      let remaining = count
      const finish = error => {
        clearTimeout(timer)
        bot.removeListener('physicsTick', tick)
        bot.removeListener('end', ended)
        error ? reject(error) : resolve()
      }
      const tick = () => { if (--remaining <= 0) finish() }
      const ended = () => finish(new Error('Bot disconnected'))
      const timer = setTimeout(() => finish(new Error('Minecraft stopped producing physics ticks')), 10000)
      bot.on('physicsTick', tick)
      bot.once('end', ended)
    })
  }

  async reset (options = {}) {
    if (!this.ready) throw new Error('Live Minecraft is not ready. Start the lab with Minecraft enabled.')
    const c = course(options)
    this.resetting = true
    this.bot.clearControlStates()
    try {
      if (!this.currentCourse || this.currentCourse.gap !== c.gap) {
        this.buildCourse(c)
        await sleep(200)
      }
      this.currentCourse = c
      this.command(`tp ParkourBot ${c.startX} ${c.floor + 1} ${c.z} -90 0`)
      // Wait for the server's teleport, then settle on the platform.
      let arrived = false
      for (let i = 0; i < 80; i++) {
        await this.ticks(1)
        const p = this.bot.entity.position
        if (Math.abs(p.x - c.startX) < 0.03 && Math.abs(p.y - c.floor - 1) < 0.05 && Math.abs(p.z - c.z) < 0.03) {
          arrived = true
          break
        }
      }
      if (!arrived) throw new Error('Teleport did not reach the starting platform')
      await this.bot.look(-Math.PI / 2, 0, true)
      await this.ticks(8)
      // Clear stale motion between independent attempts, after the server teleport.
      this.bot.entity.velocity.set(0, 0, 0)
      this.bot.jumpTicks = 0
      this.bot.jumpQueued = false
      this.episode = new Episode(c)
      this.warnings = 0
      return this.episode.result(this.bot, true)
    } finally { this.resetting = false }
  }

  async step (action) {
    if (!this.ready || !this.episode || this.episode.done) throw new Error('Reset the live environment before stepping')
    const controls = controlsFor(action)
    for (const [name, value] of Object.entries(controls)) this.bot.setControlState(name, value)
    try {
      await this.ticks(TICKS_PER_ACTION)
      const result = this.episode.result(this.bot)
      result.info.server_corrections = this.warnings
      return result
    } finally { this.bot.clearControlStates() }
  }

  close () { this.bot?.clearControlStates() }

  async shutdown () {
    if (this.closing) return
    this.closing = true
    this.ready = false
    this.bot?.quit()
    if (this.server && this.server.exitCode === null) {
      this.server.stdin.write('stop\n')
      await Promise.race([new Promise(resolve => this.server.once('exit', resolve)), sleep(15000)])
      if (this.server.exitCode === null) this.server.kill()
    }
  }
}

module.exports = { Minecraft }
