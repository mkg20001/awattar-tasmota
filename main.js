import yaml from 'js-yaml'
import fs from 'fs/promises'
import debug from 'debug'
import { fetchPrice } from './watt.js'
import cron from 'node-cron'

const log = debug('awa')

const config = yaml.load(String(await fs.readFile('config.yaml')))

function Tasmota(ip) {
  async function req(req) {
    const url = `http://${ip}/cm?cmnd=${encodeURI(req)}`
    const r = await fetch(url)
    const j = await r.json()
    return j
  }

  function status() {
    return req('status 0')
  }

  let lastState

  function applyPower({ POWER }) {
    lastState = POWER === 'ON'
  }

  return {
    async powerOn() {
      return applyPower(await req('Power On'))
    },
    async powerOff() {
      return applyPower(await req('Power off'))
    },
    weDidInit(i) {
      if (lastState === undefined) {
        lastState = i
      }
    },
    async powerStatus() {
      const { StatusSTS: { POWER } } = await status()
      const p = POWER === 'ON'
      return {
        state: p,
        weDid: lastState === p,
        ack() {
          lastState = p
        }
      }
    }
  }
}

const dev2Tasmota = {}
let marketdata = []

for (const [id, conf] of Object.entries(config.devices)) {
  dev2Tasmota[id] = Tasmota(conf.tasmota)
}

async function runToggle() {
  let currentPrice

  log('runToggle: starting')
  for (const e of marketdata) {
    if (e.current()) currentPrice = e
  }

  if (!currentPrice) return log('runToggle: no market data')

  for (const [id, conf] of Object.entries(config.devices)) {
    try {
      log('runToggle: %s', id)
      const d = await dev2Tasmota[id]
      d.weDidInit(conf.maxPrice >= currentPrice.price)
      const p = await d.powerStatus()
      if (!p.weDid) {
        if (conf.manualKeep) {
          log('runToggle: %s - device touched, but manual keep - keeping', id)
          d.lastManual = Date.now() + (60 * 60 * 1000 * conf.manualKeep) - (60 * 5 * 1000)
          p.ack()
        }
      }
      if (d.lastManual > Date.now()) {
        log('runToggle: %s - still manual keep until', id, new Date(d.lastManual))
        continue
      }
      log('runToggle: %s - max %o - current %o', id, conf.maxPrice, currentPrice.price)
      if (conf.maxPrice < currentPrice.price) {
        log('runToggle: %s - turn off', id)
        await d.powerOff()
      } else {
        log('runToggle: %s - turn on', id)
        await d.powerOn()
      }
    } catch (e) {
      console.error('runToggle: %s - FAILED %o', id, e)
    }
  }
}

async function runRefresh() {
  log('runRefresh: refreshing')
  try {
    marketdata = await fetchPrice()
  } catch (e) {
    console.error('runRefresh: FAILED %o', e)
  }
}

async function runRefreshOuter() {
  if (!marketdata || !(new Date().getHours() % 6)) {
    runRefresh()
  }
}

await runRefresh()
await runToggle()
setInterval(runRefreshOuter, 60 * 60 * 1000)

cron.schedule('*/15 * * * *', runToggle)
