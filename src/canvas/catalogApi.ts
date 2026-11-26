// Component APIs (schemas only, no DOM) for the smart-canvas catalog.
import { z, type ZodTypeAny } from 'zod';
import { CommonSchemas } from '@a2ui/web_core/v0_9';
import { A2uiColumn, A2uiText } from '@a2ui/web_core/v0_9/basic_catalog';
import { CHART_TYPES, PLAN_TEMPLATES, TREND_KINDS } from './surfacePlan';

export const LampTileApi = {
  name: 'LampTile',
  schema: z
    .object({
      label: CommonSchemas.DynamicString,
      on: CommonSchemas.DynamicBoolean,
      brightness: CommonSchemas.DynamicNumber,
      pending: CommonSchemas.DynamicBoolean.optional(),
      error: CommonSchemas.DynamicString.optional(),
      sim: CommonSchemas.DynamicBoolean.optional(),
      unreachable: CommonSchemas.DynamicBoolean.optional(),
      onToggle: CommonSchemas.Action,
      onBrighter: CommonSchemas.Action.optional(),
      onDimmer: CommonSchemas.Action.optional(),
      temp: CommonSchemas.DynamicNumber.optional(),
      color: CommonSchemas.DynamicString.optional(),
      sceneId: CommonSchemas.DynamicNumber.optional(),
      onLevel: CommonSchemas.Action.optional(),
      onColor: CommonSchemas.Action.optional(),
      onScene: CommonSchemas.Action.optional(),
      onWhite: CommonSchemas.Action.optional(),
      onWarmer: CommonSchemas.Action.optional(),
      onCooler: CommonSchemas.Action.optional(),
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

export const MusicTileApi = {
  name: 'MusicTile',
  schema: z
    .object({
      label: CommonSchemas.DynamicString,
      playing: CommonSchemas.DynamicBoolean,
      trackTitle: CommonSchemas.DynamicString.optional(),
      volume: CommonSchemas.DynamicNumber,
      pending: CommonSchemas.DynamicBoolean.optional(),
      error: CommonSchemas.DynamicString.optional(),
      onPlayPause: CommonSchemas.Action,
      onNext: CommonSchemas.Action.optional(),
      onLouder: CommonSchemas.Action.optional(),
      onSofter: CommonSchemas.Action.optional(),
      source: CommonSchemas.DynamicString.optional(),
      playingOn: CommonSchemas.DynamicString.optional(),
      onPrevious: CommonSchemas.Action.optional(),
      onVolume: CommonSchemas.Action.optional(),
    })
    .strict(),
};

export const SwitchTileApi = {
  name: 'SwitchTile',
  schema: z
    .object({
      label: CommonSchemas.DynamicString,
      on: CommonSchemas.DynamicBoolean,
      pending: CommonSchemas.DynamicBoolean.optional(),
      error: CommonSchemas.DynamicString.optional(),
      onToggle: CommonSchemas.Action,
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

export const GimbalTileApi = {
  name: 'GimbalTile',
  schema: z
    .object({
      label: CommonSchemas.DynamicString.optional(),
      docked: CommonSchemas.DynamicBoolean,
      mode: CommonSchemas.DynamicString.optional(),
      status: CommonSchemas.DynamicString,
      error: CommonSchemas.DynamicString.optional(),
      onMode: CommonSchemas.Action,
      onCue: CommonSchemas.Action,
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
  LampTile: LampTileApi.schema,
  PlanBoard: PlanBoardApi.schema,
  MusicTile: MusicTileApi.schema,
  SwitchTile: SwitchTileApi.schema,
  SceneTile: SceneTileApi.schema,
  ConnectTile: ConnectTileApi.schema,
  GimbalTile: GimbalTileApi.schema,
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
