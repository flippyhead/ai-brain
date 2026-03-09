/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as models_apiKeys_mcpAuth from "../models/apiKeys/mcpAuth.js";
import type * as models_apiKeys_model from "../models/apiKeys/model.js";
import type * as models_apiKeys_private from "../models/apiKeys/private.js";
import type * as models_apiKeys_public from "../models/apiKeys/public.js";
import type * as models_apiKeys_validators from "../models/apiKeys/validators.js";
import type * as models_reports_mcpActions from "../models/reports/mcpActions.js";
import type * as models_reports_mcpQueries from "../models/reports/mcpQueries.js";
import type * as models_reports_model from "../models/reports/model.js";
import type * as models_reports_private from "../models/reports/private.js";
import type * as models_reports_public from "../models/reports/public.js";
import type * as models_reports_validators from "../models/reports/validators.js";
import type * as models_thoughts_actions from "../models/thoughts/actions.js";
import type * as models_thoughts_helpers from "../models/thoughts/helpers.js";
import type * as models_thoughts_mcpActions from "../models/thoughts/mcpActions.js";
import type * as models_thoughts_mcpQueries from "../models/thoughts/mcpQueries.js";
import type * as models_thoughts_model from "../models/thoughts/model.js";
import type * as models_thoughts_private from "../models/thoughts/private.js";
import type * as models_thoughts_public from "../models/thoughts/public.js";
import type * as models_thoughts_publicActions from "../models/thoughts/publicActions.js";
import type * as models_thoughts_validators from "../models/thoughts/validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  http: typeof http;
  "models/apiKeys/mcpAuth": typeof models_apiKeys_mcpAuth;
  "models/apiKeys/model": typeof models_apiKeys_model;
  "models/apiKeys/private": typeof models_apiKeys_private;
  "models/apiKeys/public": typeof models_apiKeys_public;
  "models/apiKeys/validators": typeof models_apiKeys_validators;
  "models/reports/mcpActions": typeof models_reports_mcpActions;
  "models/reports/mcpQueries": typeof models_reports_mcpQueries;
  "models/reports/model": typeof models_reports_model;
  "models/reports/private": typeof models_reports_private;
  "models/reports/public": typeof models_reports_public;
  "models/reports/validators": typeof models_reports_validators;
  "models/thoughts/actions": typeof models_thoughts_actions;
  "models/thoughts/helpers": typeof models_thoughts_helpers;
  "models/thoughts/mcpActions": typeof models_thoughts_mcpActions;
  "models/thoughts/mcpQueries": typeof models_thoughts_mcpQueries;
  "models/thoughts/model": typeof models_thoughts_model;
  "models/thoughts/private": typeof models_thoughts_private;
  "models/thoughts/public": typeof models_thoughts_public;
  "models/thoughts/publicActions": typeof models_thoughts_publicActions;
  "models/thoughts/validators": typeof models_thoughts_validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
