// `server-only` throws when imported outside a React Server Component, which
// is exactly what it is for — and exactly what breaks a unit test of a module
// that (correctly) guards itself with it. Vitest aliases the package to this
// empty module so those modules can be tested directly.
export {};
