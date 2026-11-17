/**
 * Per-element records held weakly: a node that leaves the document and is
 * dropped by the page can be garbage collected without the engine having to
 * notice. The engine still needs to walk its records (to restyle after a theme
 * change, or to clean up), so live elements are listed through weak references.
 */
export class ElementRecords<T> {
  private values = new WeakMap<Element, T>();
  private list = new Set<WeakRef<Element>>();

  get(element: Element): T | undefined {
    return this.values.get(element);
  }

  has(element: Element): boolean {
    return this.values.has(element);
  }

  set(element: Element, value: T): this {
    if (!this.values.has(element)) {
      const ref = new WeakRef(element);
      this.list.add(ref);
      this.refOf(element, ref);
    }
    this.values.set(element, value);
    return this;
  }

  delete(element: Element): boolean {
    const ref = this.lookup(element);
    if (ref) {
      this.list.delete(ref);
      this.forget(element);
    }
    return this.values.delete(element);
  }

  clear(): void {
    this.values = new WeakMap();
    this.list.clear();
    this.reverse = new WeakMap();
  }

  /** Number of live records. Dead references are dropped while counting. */
  get size(): number {
    let count = 0;
    for (const _ of this.keys()) {
      count += 1;
    }
    return count;
  }

  *keys(): IterableIterator<Element> {
    for (const ref of [...this.list]) {
      const element = ref.deref();
      if (element === undefined || !this.values.has(element)) {
        this.list.delete(ref);
        continue;
      }
      yield element;
    }
  }

  *entries(): IterableIterator<[Element, T]> {
    for (const element of this.keys()) {
      const value = this.values.get(element);
      if (value !== undefined) {
        yield [element, value];
      }
    }
  }

  [Symbol.iterator](): IterableIterator<[Element, T]> {
    return this.entries();
  }

  // Element -> its weak reference, kept weakly as well.
  private reverse = new WeakMap<Element, WeakRef<Element>>();
  private refOf(element: Element, ref: WeakRef<Element>): void {
    this.reverse.set(element, ref);
  }
  private lookup(element: Element): WeakRef<Element> | undefined {
    return this.reverse.get(element);
  }
  private forget(element: Element): void {
    this.reverse.delete(element);
  }
}
