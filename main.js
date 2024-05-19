import yaml from 'js-yaml'
import fs from 'fs/promises'
import debug from 'debug'
import { fetchPrice } from './watt.js'

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

  return {
    powerOn() {
      lastState = true
      return req('Power On')
    },
    powerOff() {
      lastState = false
      return req('Power off')
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
          d.lastManual = Date.now() + (60 * 60 * 1000 * conf.manualKeep)
          p.ack()
        }
      }
      if (d.lastManual > Date.now()) {
        log('runToggle: %s - still manual keep', id)
        continue
      }
      log('runToggle: %s - max %o - current %o', id, conf.maxPrice, currentPrice.price)
      if (conf.maxPrice < currentPrice.price) {
        log('runToggle: %s - turn off', id)
        log(await d.powerOff())
      } else {
        log('runToggle: %s - turn on', id)
        log(await d.powerOn())
      }
    } catch (e) {
      console.error('runToggle: %s - FAILED %s', id, e)
    }
  }
}

async function runRefresh() {
  log('runRefresh: refreshing')
  try {
    marketdata = await fetchPrice()
  } catch (e) {

  }
}

async function runRefreshOuter() {
  if (!marketdata || !(new Date().getHours() % 8)) {
    runRefresh()
  }
}

await runRefresh()
await runToggle()
setInterval(runRefreshOuter, 60 * 60 * 1000)
setInterval(runToggle, 15 * 60 * 1000)