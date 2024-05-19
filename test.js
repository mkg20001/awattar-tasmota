const p = await fetchPrice()
console.log(p)
for (const e of p) {
  if (e.current()) console.log('current', e)
}
