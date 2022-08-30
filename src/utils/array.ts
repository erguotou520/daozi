export function omitArray<T = unknown>(origin: T[], omitList: T[]) {
  for (const item of omitList) {
    const index = origin.indexOf(item)
    if (~index) {
      origin.splice(index, 1)
    }
  }
}
