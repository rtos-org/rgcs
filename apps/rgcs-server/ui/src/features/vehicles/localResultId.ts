// Ids for results made in this browser (save / import / open failures shown in the footer pills).
// Negative so they never meet a server id, and strictly decreasing so two in one millisecond stay
// distinct (`addResult` drops an id it has already seen).
let last = 0

export function localResultId(): number {
  last = Math.min(last - 1, -Date.now())
  return last
}
