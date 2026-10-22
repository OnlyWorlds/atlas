/**
 * The producer line (folder spec §4.2, v0.3.14; Keel #477, OW Council #541):
 * which tool made a folder and from what. Atlas writes it once, at a world's
 * birth: `bare` for a world made empty (New world, the tour), `json` for a
 * world made from loose JSON, `server` for a world downloaded from
 * onlyworlds.com. An export carries its own line verbatim, or none; a later
 * write never moves it. The store half on disk: `tests/e2e/folder-store-fs.spec.ts`.
 */
import { describe, it, expect } from 'vitest';
import pkg from '../../package.json';
import { atlasProducer, importedProducer, producerLineOf } from '../../src/core/provenance';
import { parsePayload } from '../../src/import/parse';
import { reconcile } from '../../src/import/reconcile';
import { buildWorldExport } from '../../src/import/export-world';
import { linkedWorldMeta } from '../../src/setup/atlas-root-flow';
import { collectWorldFiles, zipWorld, readWorldZip } from '../../src/store/world-file';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { MockFolderStore } from '../fixtures/mock-folder-store';

const KEEL_LINE = { tool: 'keel', version: '2.4.0', input: 'server' };
const FOREIGN_LINE = { tool: 'azgaar-converter', version: '0.1.0', input: 'azgaar-map', note: 'a key Atlas does not know' };

let n = 0;
const genId = () => `0192a000-0000-7000-8000-${String(++n).padStart(12, '0')}`;

describe('the line Atlas writes', () => {
  it('names Atlas, its own version, and the input', () => {
    expect(atlasProducer('bare')).toEqual({ tool: 'atlas', version: pkg.version, input: 'bare' });
    expect(atlasProducer('json').input).toBe('json');
    expect(atlasProducer('server').input).toBe('server');
  });

  it('a download from onlyworlds.com is made from the server', () => {
    const meta = linkedWorldMeta({ serverWorldId: 'srv', displayName: 'Hollow Reach', apiKey: 'ow_w_x' });
    expect(meta.producer).toEqual({ tool: 'atlas', version: pkg.version, input: 'server' });
  });
});

describe('a world made from an import', () => {
  it("keel's export keeps keel's line, verbatim", () => {
    const plan = reconcile(parsePayload({
      format: 'onlyworlds-world-export', schema_version: '00.32.02',
      world: { id: 'srv', name: 'Hollow Reach', producer: KEEL_LINE },
      elements: { character: [{ id: genId(), name: 'Ana' }] },
    }), [], { genId });
    expect(plan.envelope).toBe(true);
    expect(importedProducer(plan)).toEqual({ producer: KEEL_LINE });
  });

  it('an export with no line stays without one: a copy never invents its maker', () => {
    const plan = reconcile(parsePayload({
      format: 'onlyworlds-world-export', schema_version: '00.32.02',
      world: { id: 'srv', name: 'Made before the line' },
      elements: { character: [{ id: genId(), name: 'Ana' }] },
    }), [], { genId });
    expect(plan.envelope).toBe(true);
    expect(importedProducer(plan)).toEqual({});
  });

  it("the convert-notes prompt's shape is json, with a World block or without", () => {
    const full = reconcile(parsePayload({ World: { name: 'Emberfall' }, Character: [{ name: 'Aralia' }] }), [], { genId });
    expect(full.envelope).toBeUndefined();
    expect(importedProducer(full)).toEqual({ producer: { tool: 'atlas', version: pkg.version, input: 'json' } });
    const loose = reconcile(parsePayload({ Character: [{ name: 'Aralia' }] }), [], { genId });
    expect(importedProducer(loose)).toEqual({ producer: { tool: 'atlas', version: pkg.version, input: 'json' } });
  });

  it('a line in a World block is kept as written, a word Atlas does not know included', () => {
    const plan = reconcile(parsePayload({ World: { name: 'Azgaar', producer: FOREIGN_LINE }, Location: [{ name: 'Vallaki' }] }), [], { genId });
    expect(importedProducer(plan)).toEqual({ producer: FOREIGN_LINE });
  });

  it('a line that is not an object is no line (world data is untrusted)', () => {
    for (const bad of ['atlas', ['atlas'], null, 3]) {
      const plan = reconcile(parsePayload({ World: { name: 'X', producer: bad }, Character: [{ name: 'A' }] }), [], { genId });
      expect(producerLineOf(plan.worldMeta)).toBeNull();
      expect(importedProducer(plan).producer?.input).toBe('json');
    }
  });
});

describe('the line travels with every copy', () => {
  it("Atlas's own export carries it, and importing that export keeps it", async () => {
    const store = new MockFolderStore();
    await store.writeWorldMeta({ id: genId(), name: 'Born here', producer: atlasProducer('bare') });
    const exported = await buildWorldExport(store);
    expect((exported.world as Record<string, unknown>).producer).toEqual(atlasProducer('bare'));
    const plan = reconcile(parsePayload(exported), [], { genId });
    expect(importedProducer(plan)).toEqual({ producer: atlasProducer('bare') });
  });

  it('a world file carries it byte for byte', async () => {
    const d = new FakeDirHandle('w');
    d.put('world.json', JSON.stringify({ id: '0192a000-aaaa-7bbb-8ccc-000000000001', name: 'Hollow Reach', producer: FOREIGN_LINE }));
    const back = readWorldZip(zipWorld(await collectWorldFiles(d as never), 'hollow-reach'));
    const meta = JSON.parse(new TextDecoder().decode(back.files.find(f => f.path === 'world.json')!.data));
    expect(meta.producer).toEqual(FOREIGN_LINE);
  });
});

describe('written once', () => {
  it('a later write never moves the line, nor adds one to a world born without', async () => {
    const made = new MockFolderStore();
    await made.writeWorldMeta({ id: genId(), name: 'Born', producer: atlasProducer('bare') });
    await made.writeWorldMeta({ name: 'Renamed', producer: atlasProducer('server') });
    expect((await made.readWorldMeta()).producer).toEqual(atlasProducer('bare'));

    const without = new MockFolderStore();
    await without.writeWorldMeta({ id: genId(), name: 'No line' });
    await without.writeWorldMeta({ producer: atlasProducer('json') });
    expect((await without.readWorldMeta()).producer).toBeUndefined();
  });
});
