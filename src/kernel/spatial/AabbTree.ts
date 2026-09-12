import { aabbHalfSurfaceArea, aabbIntersects, aabbUnion, type Aabb } from '../math/aabb';

const NULL_NODE = -1;

interface TreeNode {
  box: Aabb;
  parent: number;
  child1: number;
  child2: number;
  /** 0 for leaves, -1 for nodes on the free list. */
  height: number;
  /** Item id for leaves, NULL_NODE for internal nodes. */
  item: number;
}

/**
 * Dynamic bounding volume hierarchy over integer item ids.
 *
 * Insertion picks a sibling with the surface-area heuristic, and AVL-style rotations keep the tree balanced,
 * following the well-known dynamic tree design from Box2D. Boxes are stored exactly, without fattening, because
 * kernel edits are sparse compared with per-frame physics updates.
 */
export class AabbTree {
  readonly #nodes: TreeNode[] = [];
  readonly #freeList: number[] = [];
  readonly #leafByItem = new Map<number, number>();
  #root = NULL_NODE;

  get size(): number {
    return this.#leafByItem.size;
  }

  /** Height of the tree: -1 when empty, 0 for a single leaf. */
  get height(): number {
    return this.#root === NULL_NODE ? -1 : this.#node(this.#root).height;
  }

  has(item: number): boolean {
    return this.#leafByItem.has(item);
  }

  boxOf(item: number): Aabb | undefined {
    const leaf = this.#leafByItem.get(item);
    return leaf === undefined ? undefined : this.#node(leaf).box;
  }

  insert(item: number, box: Aabb): void {
    if (this.#leafByItem.has(item)) throw new Error(`AabbTree: item ${String(item)} is already present`);
    const leaf = this.#allocate(box, item);
    this.#leafByItem.set(item, leaf);
    this.#insertLeaf(leaf);
  }

  remove(item: number): boolean {
    const leaf = this.#leafByItem.get(item);
    if (leaf === undefined) return false;
    this.#leafByItem.delete(item);
    this.#removeLeaf(leaf);
    this.#free(leaf);
    return true;
  }

  update(item: number, box: Aabb): void {
    this.remove(item);
    this.insert(item, box);
  }

  clear(): void {
    this.#nodes.length = 0;
    this.#freeList.length = 0;
    this.#leafByItem.clear();
    this.#root = NULL_NODE;
  }

  /** Calls `visit` for every item whose box intersects `box` (touching counts). Visit order is not specified. */
  query(box: Aabb, visit: (item: number) => void): void {
    if (this.#root === NULL_NODE) return;
    const stack = [this.#root];
    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) break;
      const node = this.#node(index);
      if (!aabbIntersects(node.box, box)) continue;
      if (node.child1 === NULL_NODE) {
        visit(node.item);
      } else {
        stack.push(node.child1, node.child2);
      }
    }
  }

  queryItems(box: Aabb): number[] {
    const items: number[] = [];
    this.query(box, (item) => items.push(item));
    return items;
  }

  /** Structural self-check used by tests. Returns human-readable problems; empty when the tree is consistent. */
  validate(): string[] {
    const problems: string[] = [];
    if (this.#root === NULL_NODE) {
      if (this.#leafByItem.size > 0) problems.push('empty root but leaves registered');
      return problems;
    }
    if (this.#node(this.#root).parent !== NULL_NODE) problems.push('root has a parent');
    let leafCount = 0;
    const walk = (index: number): void => {
      const node = this.#node(index);
      if (node.child1 === NULL_NODE) {
        leafCount++;
        if (node.height !== 0) problems.push(`leaf ${String(index)} has height ${String(node.height)}`);
        if (this.#leafByItem.get(node.item) !== index) problems.push(`leaf ${String(index)} not registered`);
        return;
      }
      const child1 = this.#node(node.child1);
      const child2 = this.#node(node.child2);
      if (child1.parent !== index || child2.parent !== index)
        problems.push(`bad parent link at ${String(index)}`);
      if (node.height !== 1 + Math.max(child1.height, child2.height)) {
        problems.push(`bad height at ${String(index)}`);
      }
      const union = aabbUnion(child1.box, child2.box);
      const b = node.box;
      if (
        b.minX !== union.minX ||
        b.minY !== union.minY ||
        b.minZ !== union.minZ ||
        b.maxX !== union.maxX ||
        b.maxY !== union.maxY ||
        b.maxZ !== union.maxZ
      ) {
        problems.push(`box at ${String(index)} is not the union of its children`);
      }
      if (Math.abs(child1.height - child2.height) > 1) problems.push(`unbalanced node ${String(index)}`);
      walk(node.child1);
      walk(node.child2);
    };
    walk(this.#root);
    if (leafCount !== this.#leafByItem.size) problems.push('leaf count mismatch');
    return problems;
  }

  #node(index: number): TreeNode {
    const node = this.#nodes[index];
    if (!node) throw new Error(`AabbTree: invalid node index ${String(index)}`);
    return node;
  }

  #allocate(box: Aabb, item: number): number {
    const node: TreeNode = { box, parent: NULL_NODE, child1: NULL_NODE, child2: NULL_NODE, height: 0, item };
    const reused = this.#freeList.pop();
    if (reused !== undefined) {
      this.#nodes[reused] = node;
      return reused;
    }
    this.#nodes.push(node);
    return this.#nodes.length - 1;
  }

  #free(index: number): void {
    const node = this.#node(index);
    node.height = -1;
    node.item = NULL_NODE;
    node.parent = NULL_NODE;
    node.child1 = NULL_NODE;
    node.child2 = NULL_NODE;
    this.#freeList.push(index);
  }

  #insertLeaf(leaf: number): void {
    if (this.#root === NULL_NODE) {
      this.#root = leaf;
      this.#node(leaf).parent = NULL_NODE;
      return;
    }

    // Walk down to the best sibling by the surface-area heuristic.
    const leafBox = this.#node(leaf).box;
    let index = this.#root;
    while (this.#node(index).child1 !== NULL_NODE) {
      const node = this.#node(index);
      const area = aabbHalfSurfaceArea(node.box);
      const combinedArea = aabbHalfSurfaceArea(aabbUnion(node.box, leafBox));
      const cost = 2 * combinedArea;
      const inheritanceCost = 2 * (combinedArea - area);
      const cost1 = this.#descendCost(node.child1, leafBox, inheritanceCost);
      const cost2 = this.#descendCost(node.child2, leafBox, inheritanceCost);
      if (cost < cost1 && cost < cost2) break;
      index = cost1 < cost2 ? node.child1 : node.child2;
    }

    const sibling = index;
    const siblingNode = this.#node(sibling);
    const oldParent = siblingNode.parent;
    const newParent = this.#allocate(aabbUnion(leafBox, siblingNode.box), NULL_NODE);
    const newParentNode = this.#node(newParent);
    newParentNode.parent = oldParent;
    newParentNode.height = siblingNode.height + 1;
    newParentNode.child1 = sibling;
    newParentNode.child2 = leaf;
    siblingNode.parent = newParent;
    this.#node(leaf).parent = newParent;

    if (oldParent === NULL_NODE) {
      this.#root = newParent;
    } else {
      const oldParentNode = this.#node(oldParent);
      if (oldParentNode.child1 === sibling) oldParentNode.child1 = newParent;
      else oldParentNode.child2 = newParent;
    }

    this.#refitUpwards(newParent);
  }

  #descendCost(child: number, leafBox: Aabb, inheritanceCost: number): number {
    const childNode = this.#node(child);
    const combined = aabbHalfSurfaceArea(aabbUnion(leafBox, childNode.box));
    if (childNode.child1 === NULL_NODE) return combined + inheritanceCost;
    return combined - aabbHalfSurfaceArea(childNode.box) + inheritanceCost;
  }

  #removeLeaf(leaf: number): void {
    if (leaf === this.#root) {
      this.#root = NULL_NODE;
      return;
    }
    const parent = this.#node(leaf).parent;
    const parentNode = this.#node(parent);
    const grandParent = parentNode.parent;
    const sibling = parentNode.child1 === leaf ? parentNode.child2 : parentNode.child1;

    if (grandParent === NULL_NODE) {
      this.#root = sibling;
      this.#node(sibling).parent = NULL_NODE;
      this.#free(parent);
      return;
    }

    const grandParentNode = this.#node(grandParent);
    if (grandParentNode.child1 === parent) grandParentNode.child1 = sibling;
    else grandParentNode.child2 = sibling;
    this.#node(sibling).parent = grandParent;
    this.#free(parent);
    this.#refitUpwards(grandParent);
  }

  #refitUpwards(start: number): void {
    let index = start;
    while (index !== NULL_NODE) {
      index = this.#balance(index);
      const node = this.#node(index);
      const child1 = this.#node(node.child1);
      const child2 = this.#node(node.child2);
      node.height = 1 + Math.max(child1.height, child2.height);
      node.box = aabbUnion(child1.box, child2.box);
      index = node.parent;
    }
  }

  /** Rotates at node `iA` when its subtrees differ in height by more than one. Returns the new subtree root. */
  #balance(iA: number): number {
    const A = this.#node(iA);
    if (A.child1 === NULL_NODE || A.height < 2) return iA;

    const iB = A.child1;
    const iC = A.child2;
    const B = this.#node(iB);
    const C = this.#node(iC);
    const balance = C.height - B.height;

    if (balance > 1) {
      const iF = C.child1;
      const iG = C.child2;
      const F = this.#node(iF);
      const G = this.#node(iG);
      C.child1 = iA;
      C.parent = A.parent;
      A.parent = iC;
      this.#replaceChild(C.parent, iA, iC);
      if (F.height > G.height) {
        C.child2 = iF;
        A.child2 = iG;
        G.parent = iA;
        A.box = aabbUnion(B.box, G.box);
        C.box = aabbUnion(A.box, F.box);
        A.height = 1 + Math.max(B.height, G.height);
        C.height = 1 + Math.max(A.height, F.height);
      } else {
        C.child2 = iG;
        A.child2 = iF;
        F.parent = iA;
        A.box = aabbUnion(B.box, F.box);
        C.box = aabbUnion(A.box, G.box);
        A.height = 1 + Math.max(B.height, F.height);
        C.height = 1 + Math.max(A.height, G.height);
      }
      return iC;
    }

    if (balance < -1) {
      const iD = B.child1;
      const iE = B.child2;
      const D = this.#node(iD);
      const E = this.#node(iE);
      B.child1 = iA;
      B.parent = A.parent;
      A.parent = iB;
      this.#replaceChild(B.parent, iA, iB);
      if (D.height > E.height) {
        B.child2 = iD;
        A.child1 = iE;
        E.parent = iA;
        A.box = aabbUnion(C.box, E.box);
        B.box = aabbUnion(A.box, D.box);
        A.height = 1 + Math.max(C.height, E.height);
        B.height = 1 + Math.max(A.height, D.height);
      } else {
        B.child2 = iE;
        A.child1 = iD;
        D.parent = iA;
        A.box = aabbUnion(C.box, D.box);
        B.box = aabbUnion(A.box, E.box);
        A.height = 1 + Math.max(C.height, D.height);
        B.height = 1 + Math.max(A.height, E.height);
      }
      return iB;
    }

    return iA;
  }

  #replaceChild(parent: number, oldChild: number, newChild: number): void {
    if (parent === NULL_NODE) {
      this.#root = newChild;
      return;
    }
    const parentNode = this.#node(parent);
    if (parentNode.child1 === oldChild) parentNode.child1 = newChild;
    else parentNode.child2 = newChild;
  }
}
