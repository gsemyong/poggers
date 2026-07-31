/**
 * Orders providers before consumers while retaining mutually dependent
 * contributions as one deterministic, lazily bound component.
 */
export function orderDependencyGraph(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): readonly string[] {
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  const visit = (node: string): void => {
    const nodeIndex = nextIndex++;
    indices.set(node, nodeIndex);
    lowLinks.set(node, nodeIndex);
    stack.push(node);
    stacked.add(node);
    for (const dependency of [...(graph.get(node) ?? [])].sort()) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!));
      } else if (stacked.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(dependency)!));
      }
    }
    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member === undefined) break;
      stacked.delete(member);
      component.push(member);
    } while (member !== node);
    components.push(component.sort());
  };

  for (const node of [...graph.keys()].sort()) {
    if (!indices.has(node)) visit(node);
  }
  return components.flat();
}
