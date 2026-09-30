const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const readline = require('node:readline/promises')
const { Simulator } = require('./simulator')
const { Minecraft } = require('./minecraft')
const { VERSION, ACTION_NAMES, OBS_NAMES } = require('./task')

const root = path.resolve(__dirname, '..')
const bridgePath = path.join(root, '.bridge.json')
const port = Number(process.env.PARKOUR_PORT || 8765)
const token = crypto.randomBytes(24).toString('hex')
const sessions = new Map()
const minecraft = new Minecraft(root)
let stopping = false
let liveError = null

function send (res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function body (req) {
  let text = ''
  for await (const part of req) {
    text += part
    if (text.length > 8192) throw new Error('Request is too large')
  }
  return text ? JSON.parse(text) : {}
}

const api = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: 'Use the local bridge credentials' })
  try {
    if (req.method === 'GET' && req.url === '/status') {
      return send(res, 200, { version: VERSION, simulator: true, live: minecraft.ready, live_error: liveError, actions: ACTION_NAMES, observations: OBS_NAMES })
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'POST required' })
    const data = await body(req)
    if (req.url === '/env') {
      if (!['sim', 'live'].includes(data.backend)) return send(res, 400, { error: 'Choose sim or live backend' })
      if (sessions.size >= 8) return send(res, 409, { error: 'Too many environments; restart the lab to release abandoned sessions' })
      if (data.backend === 'live' && (!minecraft.ready || [...sessions.values()].some(s => s.backend === 'live'))) {
        return send(res, 409, { error: 'Live Minecraft is not ready, or another trainer is using the bot' })
      }
      const id = crypto.randomUUID()
      sessions.set(id, { backend: data.backend, env: data.backend === 'live' ? minecraft : new Simulator(), busy: false })
      return send(res, 200, { id, actions: ACTION_NAMES.length, observations: OBS_NAMES.length })
    }
    if (req.url === '/shutdown') {
      send(res, 200, { stopping: true })
      setImmediate(shutdown)
      return
    }
    const match = req.url.match(/^\/env\/([a-z0-9-]+)\/(reset|step|close)$/)
    if (!match || !sessions.has(match[1])) return send(res, 404, { error: 'Unknown environment' })
    const session = sessions.get(match[1])
    if (session.busy) return send(res, 409, { error: 'This environment is busy' })
    session.busy = true
    try {
      if (match[2] === 'close') {
        session.env.close()
        sessions.delete(match[1])
        return send(res, 200, { closed: true })
      }
      const result = match[2] === 'reset' ? await session.env.reset(data) : await session.env.step(data.action)
      return send(res, 200, result)
    } finally { session.busy = false }
  } catch (error) { send(res, 400, { error: error.message }) }
})

async function shutdown () {
  if (stopping) return
  stopping = true
  for (const session of sessions.values()) session.env.close()
  await minecraft.shutdown()
  api.close()
  try {
    if (JSON.parse(fs.readFileSync(bridgePath, 'utf8')).token === token) fs.unlinkSync(bridgePath)
  } catch {}
  process.exit(0)
}

async function main () {
  fs.mkdirSync(path.join(root, 'server'), { recursive: true })
  let simOnly = process.argv.includes('--sim-only')
  if (!simOnly) {
    const eula = path.join(root, 'server', 'eula.txt')
    const accepted = fs.existsSync(eula) && /^eula=true\s*$/m.test(fs.readFileSync(eula, 'utf8'))
    if (!accepted) {
      console.log('Minecraft requires your agreement to its EULA before starting its server.')
      console.log('Read it here: https://www.minecraft.net/en-us/eula')
      console.log('Type AGREE to accept and start Minecraft, or press Enter for simulator-only training.')
      const prompt = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = await prompt.question('Your choice: ')
      prompt.close()
      if (answer.trim() === 'AGREE') fs.writeFileSync(eula, '# Accepted interactively by the user.\neula=true\n')
      else simOnly = true
    }
  }
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(port, '127.0.0.1', resolve) })
  fs.writeFileSync(bridgePath, JSON.stringify({ url: `http://127.0.0.1:${port}`, token, pid: process.pid }, null, 2))
  console.log(`Parkour Lab is ready. Simulator: on. Minecraft version: ${VERSION}.`)
  console.log('Train with ./lab train (WSL/Linux) or Train.cmd (Windows). Leave this window open.')
  if (!simOnly) {
    try { await minecraft.start() } catch (error) {
      liveError = error.message
      console.error(`Live Minecraft could not start: ${error.message}`)
      await minecraft.shutdown()
      console.log('Simulator training is still available.')
    }
  } else console.log('Simulator only. To watch in Minecraft, stop this lab and run ./lab start or Start-Lab.cmd.')
  console.log('Press Ctrl+C to save the Minecraft world and stop the lab.')
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
main().catch(error => { console.error(error.message); process.exitCode = 1; api.close() })
