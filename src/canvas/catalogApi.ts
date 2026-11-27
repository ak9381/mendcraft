// Component APIs (schemas only, no DOM) for the smart-canvas catalog.
import { z, type ZodTypeAny } from 'zod';
import { CommonSchemas } from '@a2ui/web_core/v0_9';
import { A2uiColumn, A2uiText } from '@a2ui/web_core/v0_9/basic_catalog';
import { CHART_TYPES, PLAN_TEMPLATES, TREND_KINDS } from './surfacePlan';
import { CONTROL_LABEL_MAX, MAX_CHIP_OPTIONS, MAX_CONTROLS } from './controlSpec';

// ---- the one device tile: any device leaf, drawn from its approved controls ----
const LevelSchema = z.union([z.number(), z.literal('$value'), z.object({ step: z.union([z.literal(1), z.literal(-1)]) }).strict()]);
const OnOff = z.union([z.boolean(), z.literal('toggle')]);
/** Exactly one key per intent (coerceControls already checked the values
 *  against the class tables; this is the gate's second look at the shape). */
const IntentSchema = z.union([
  z.object({ on: OnOff }).strict(),
  z.object({ brightness: LevelSchema }).strict(),
  z.object({ temp: LevelSchema }).strict(),
  z.object({ rgb: z.object({ r: z.number(), g: z.number(), b: z.number() }).strict() }).strict(),
  z.object({ sceneId: z.number() }).strict(),
  z.object({ playing: OnOff }).strict(),
  z.object({ volume: LevelSchema }).strict(),
  z.object({ next: z.literal(true) }).strict(),
  z.object({ previous: z.literal(true) }).strict(),
  z.object({ gimbalMode: z.enum(['face', 'hands', 'hold']) }).strict(),
  z.object({ gimbalCue: z.enum(['yes', 'no', 'wakeup']) }).strict(),
]);
const ControlLabel = z.string().min(1).max(CONTROL_LABEL_MAX).regex(/^[^<>]*$/);
export const ControlSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('toggle'), label: ControlLabel, intent: IntentSchema }).strict(),
  z.object({ kind: z.literal('slider'), label: ControlLabel, key: z.enum(['brightness', 'volume', 'temp']) }).strict(),
  z.object({ kind: z.literal('button'), label: ControlLabel, intent: IntentSchema }).strict(),
  z.object({ kind: z.literal('chips'), label: ControlLabel, options: z.array(z.object({ label: ControlLabel, intent: IntentSchema }).strict()).min(1).max(MAX_CHIP_OPTIONS) }).strict(),
  z.object({ kind: z.literal('readout'), label: ControlLabel.optional(), show: z.enum(['state', 'trackTitle', 'playingOn', 'source', 'status']) }).strict(),
]);

export const DeviceTileApi = {
  name: 'DeviceTile',
  schema: z
    .object({
      cls: z.enum(['lamp', 'music', 'switch', 'gimbal']),
      label: CommonSchemas.DynamicString,
      deviceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional(),
      controls: z.array(ControlSchema).max(MAX_CONTROLS),
      on: CommonSchemas.DynamicBoolean.optional(),
      brightness: CommonSchemas.DynamicNumber.optional(),
      temp: CommonSchemas.DynamicNumber.optional(),
      color: CommonSchemas.DynamicString.optional(),
      sceneId: CommonSchemas.DynamicNumber.optional(),
      playing: CommonSchemas.DynamicBoolean.optional(),
      volume: CommonSchemas.DynamicNumber.optional(),
      trackTitle: CommonSchemas.DynamicString.optional(),
      playingOn: CommonSchemas.DynamicString.optional(),
      source: CommonSchemas.DynamicString.optional(),
      status: CommonSchemas.DynamicString.optional(),
      /** Gimbal: the mode the iPhone reported ('face' | 'hands' | 'hold' | ''). */
      mode: CommonSchemas.DynamicString.optional(),
      pending: CommonSchemas.DynamicBoolean.optional(),
      error: CommonSchemas.DynamicString.optional(),
      sim: CommonSchemas.DynamicBoolean.optional(),
      unreachable: CommonSchemas.DynamicBoolean.optional(),
      /** Lamp: 'generated' | 'built-in' | 'none' — what it runs on (footnoted unless generated). */
      connector: CommonSchemas.DynamicString.optional(),
      /** Lamp on a generated connector: its maker line, shown as the footnote. */
      connectorBy: CommonSchemas.DynamicString.optional(),
      /** The model wrote no controls: these were derived (footnoted "Standard controls"). */
      standard: z.boolean(),
      /** One event; a press adds only its control (and option) index. */
      onAct: CommonSchemas.Action,
    })
    .strict(),
};

export const PlanBoardApi = {
  name: 'PlanBoard',
  schema: z
    .object({
      boardId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
      template: z.enum(PLAN_TEMPLATES),
    })
    .strict(),
};

export const SceneTileApi = {
  name: 'SceneTile',
  schema: z
    .object({
      label: CommonSchemas.DynamicString,
      active: CommonSchemas.DynamicBoolean.optional(),
      onActivate: CommonSchemas.Action,
    })
    .strict(),
};

export const ConnectTileApi = {
  name: 'ConnectTile',
  schema: z
    .object({
      label: CommonSchemas.DynamicString.optional(),
      onConnect: CommonSchemas.Action,
    })
    .strict(),
};

// ---- layout containers (nested A2UI trees) ----

export const RowApi = {
  name: 'Row',
  schema: z.object({ children: z.array(z.string()) }).strict(),
};

export const GridApi = {
  name: 'Grid',
  schema: z
    .object({
      columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      children: z.array(z.string()),
    })
    .strict(),
};

export const CardApi = {
  name: 'Card',
  schema: z.object({ title: z.string(), children: z.array(z.string()) }).strict(),
};

export const TabsApi = {
  name: 'Tabs',
  schema: z
    .object({
      tabs: z.array(z.object({ label: z.string(), children: z.array(z.string()) }).strict()),
    })
    .strict(),
};

export const SplitApi = {
  name: 'Split',
  schema: z
    .object({
      direction: z.enum(['row', 'column']),
      // Reuses the same flat `children` id array every other container uses
      // (so fallbackRenderer's generic child-linking needs no Split-specific
      // case) — the first `firstCount` ids are pane one, the rest are pane two.
      firstCount: z.number().int().min(0),
      children: z.array(z.string()),
    })
    .strict(),
};

// ---- general-purpose widgets ----

export const StatTileApi = {
  name: 'StatTile',
  schema: z
    .object({
      label: z.string(),
      value: z.string(),
      delta: z.string(),
      trend: z.enum(TREND_KINDS),
      spark: z.array(z.number()),
    })
    .strict(),
};

export const ChartTileApi = {
  name: 'ChartTile',
  schema: z
    .object({
      title: z.string(),
      chartType: z.enum(CHART_TYPES),
      series: z.array(z.object({ label: z.string(), value: z.number() }).strict()),
    })
    .strict(),
};

export const TableTileApi = {
  name: 'TableTile',
  schema: z
    .object({
      title: z.string(),
      columns: z.array(z.string()),
      rows: z.array(z.array(z.string())),
      /** Rows filled from what the devices report (a live devices table). */
      live: z.boolean(),
      sortable: z.boolean(),
      rowActionLabel: z.string(),
      onRowAction: CommonSchemas.Action,
    })
    .strict(),
};

const FormFieldSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('toggle'), id: z.string(), label: z.string(), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('slider'), id: z.string(), label: z.string(), value: z.number(), min: z.number(), max: z.number() }).strict(),
  z.object({ kind: z.literal('choice'), id: z.string(), label: z.string(), options: z.array(z.string()), value: z.string() }).strict(),
]);

export const FormTileApi = {
  name: 'FormTile',
  schema: z
    .object({
      title: z.string(),
      fields: z.array(FormFieldSchema),
      submitLabel: z.string(),
      onSubmit: CommonSchemas.Action,
    })
    .strict(),
};

export const VisualTileApi = {
  name: 'VisualTile',
  schema: z
    .object({
      title: z.string(),
      markup: z.string(),
      onAction: CommonSchemas.Action,
    })
    .strict(),
};

/** Every component the gate allows, by name. */
export const CATALOG_SCHEMAS: Record<string, ZodTypeAny> = {
  Column: A2uiColumn.schema,
  Text: A2uiText.schema,
  DeviceTile: DeviceTileApi.schema,
  PlanBoard: PlanBoardApi.schema,
  SceneTile: SceneTileApi.schema,
  ConnectTile: ConnectTileApi.schema,
  Row: RowApi.schema,
  Grid: GridApi.schema,
  Card: CardApi.schema,
  Tabs: TabsApi.schema,
  Split: SplitApi.schema,
  StatTile: StatTileApi.schema,
  ChartTile: ChartTileApi.schema,
  TableTile: TableTileApi.schema,
  FormTile: FormTileApi.schema,
  VisualTile: VisualTileApi.schema,
};
