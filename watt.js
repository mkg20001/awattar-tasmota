export async function fetchPrice() {
  const req = await fetch('https://api.awattar.at/v1/marketdata')
  const data = await req.json()

  const out = []

  for (const { start_timestamp, end_timestamp, marketprice, unit } of data.data) {
    if (unit !== 'Eur/MWh') throw new Error('unit not matching')

    out.push({
      start: new Date(start_timestamp),
      end: new Date(end_timestamp),
      price: marketprice * 100 / 1000,
      unit: 'ct/kwh'
    })
  }

  return out
}

console.log(await fetchPrice())
