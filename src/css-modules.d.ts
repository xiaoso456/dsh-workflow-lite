/** CSS Modules 的类名表声明（由 tsdown 的 lightningcss 插件产出）。 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
