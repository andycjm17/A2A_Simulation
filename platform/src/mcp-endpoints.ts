/** OAuth discovery, authorization and tokens must use the same canonical origin. */
export function chatgptEndpoint(origin = location.origin) {
  const url = new URL(origin);
  const productionHosts = ["a2asimulation.com", "www.a2asimulation.com", "a2a.andycui.com"];
  return `${productionHosts.includes(url.hostname) ? "https://a2asimulation.com" : url.origin}/mcp`;
}
