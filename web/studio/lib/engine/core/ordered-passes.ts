// OrderedPassList: keeps composer.passes sorted by index.

export class OrderedPassList<T = unknown> {
  array: { index: number; item: T }[] = [];
  sourceArray: T[];

  constructor(sourceArray?: T[]) {
    this.sourceArray = sourceArray || [];
  }

  add(item: T, index: number) {
    this.array.push({ index, item });
    this.array.sort(this.sort);
    this.updateSourceArray();
  }

  remove(item: T) {
    for (let t = 0; t < this.array.length; t++) if (this.array[t].item === item) this.array.splice(t, 1);
    this.updateSourceArray();
  }

  updateSourceArray() {
    this.sourceArray.length = 0;
    for (let e = 0; e < this.array.length; e++) this.sourceArray[e] = this.array[e].item;
  }

  sort(a: { index: number }, b: { index: number }) {
    return a.index > b.index ? 1 : -1;
  }
}
