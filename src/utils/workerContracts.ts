/** Descriptions are documentation, not part of the executable contract. */
export function contractSignature(functions: { name: string; params: any }[] | undefined): string {
  function canonical(value: any): any {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map(key => [key, canonical(value[key])])
      )
    }
    return value
  }
  return JSON.stringify(
    (functions || [])
      .map(fn => ({
        name: fn.name,
        params: canonical(
          Object.fromEntries(
            Object.entries(fn.params || {}).map(([name, definition]) => {
              const { description, ...rules } = definition as Record<string, unknown>
              return [name, rules]
            })
          )
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  )
}
