import { fetchPrice } from './watt.js'

const p = await fetchPrice()

for (const e of p) {
  if (e.current()) console.log('current', e)
}
