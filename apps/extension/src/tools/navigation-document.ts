/** Operation-local identity. Navigation may replace documents, never the target tab. */
export class NavigationDocument {
  private readonly retired = new Set<string>();
  id: string | undefined;
  version = 0;
  pending = false;

  retire(id: string | undefined): void {
    if (id) this.retired.add(id);
  }

  isRetired(id: string | undefined): boolean {
    return !!id && this.retired.has(id);
  }

  begin(): void {
    this.retire(this.id);
    this.id = undefined;
    this.pending = true;
    this.version += 1;
  }

  commit(id: string | undefined): boolean {
    if (!id || this.isRetired(id) || this.id === id) return false;
    this.retire(this.id);
    this.id = id;
    this.pending = false;
    this.version += 1;
    return true;
  }

  isCurrent(version: number): boolean {
    return this.version === version && !this.pending;
  }
}
