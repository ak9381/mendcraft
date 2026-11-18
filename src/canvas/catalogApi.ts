// Component APIs (schemas only, no DOM) for the smart-canvas catalog.
import { z, type ZodTypeAny } from 'zod';
import { CommonSchemas } from '@a2ui/web_core/v0_9';
import { A2uiColumn, A2uiText } from '@a2ui/web_core/v0_9/basic_catalog';
import { PLAN_TEMPLATES } from './surfacePlan';

export const LampTileApi = {
  name: 'LampTile',
  schema: z
    .object({
      label: CommonSchemas.DynamicString,
      on: CommonSchemas.DynamicBoolean,
      brightness: CommonSchemas.DynamicNumber,
      pending: CommonSchemas.DynamicBoolean.optional(),
      error: CommonSchemas.DynamicString.optional(),
      onToggle: CommonSchemas.Action,
      onBrighter: CommonSchemas.Action.optional(),
      onDimmer: CommonSchemas.Action.optional(),
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

/** Every component the gate allows, by name. */
export const CATALOG_SCHEMAS: Record<string, ZodTypeAny> = {
  Column: A2uiColumn.schema,
  Text: A2uiText.schema,
  LampTile: LampTileApi.schema,
  PlanBoard: PlanBoardApi.schema,
};
