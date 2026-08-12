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
import type * as lib_mcpAuth from "../lib/mcpAuth.js";
import type * as lib_webAuth from "../lib/webAuth.js";
import type * as models_apiKeys_mcpAuth from "../models/apiKeys/mcpAuth.js";
import type * as models_apiKeys_model from "../models/apiKeys/model.js";
import type * as models_apiKeys_private from "../models/apiKeys/private.js";
import type * as models_apiKeys_public from "../models/apiKeys/public.js";
import type * as models_apiKeys_validators from "../models/apiKeys/validators.js";
import type * as models_facts_mcpActions from "../models/facts/mcpActions.js";
import type * as models_facts_mcpQueries from "../models/facts/mcpQueries.js";
import type * as models_facts_model from "../models/facts/model.js";
import type * as models_facts_private from "../models/facts/private.js";
import type * as models_facts_public from "../models/facts/public.js";
import type * as models_facts_validators from "../models/facts/validators.js";
import type * as models_lists_mcpActions from "../models/lists/mcpActions.js";
import type * as models_lists_mcpQueries from "../models/lists/mcpQueries.js";
import type * as models_lists_model from "../models/lists/model.js";
import type * as models_lists_private from "../models/lists/private.js";
import type * as models_lists_public from "../models/lists/public.js";
import type * as models_lists_validators from "../models/lists/validators.js";
import type * as models_oauth_mcpMutations from "../models/oauth/mcpMutations.js";
import type * as models_oauth_validators from "../models/oauth/validators.js";
import type * as models_recallBlend from "../models/recallBlend.js";
import type * as models_reports_mcpActions from "../models/reports/mcpActions.js";
import type * as models_reports_mcpMutations from "../models/reports/mcpMutations.js";
import type * as models_reports_mcpQueries from "../models/reports/mcpQueries.js";
import type * as models_reports_model from "../models/reports/model.js";
import type * as models_reports_private from "../models/reports/private.js";
import type * as models_reports_public from "../models/reports/public.js";
import type * as models_reports_validators from "../models/reports/validators.js";
import type * as models_thoughts_actions from "../models/thoughts/actions.js";
import type * as models_thoughts_classify from "../models/thoughts/classify.js";
import type * as models_thoughts_evalRecall from "../models/thoughts/evalRecall.js";
import type * as models_thoughts_helpers from "../models/thoughts/helpers.js";
import type * as models_thoughts_mcpActions from "../models/thoughts/mcpActions.js";
import type * as models_thoughts_mcpQueries from "../models/thoughts/mcpQueries.js";
import type * as models_thoughts_memoryAnalysis from "../models/thoughts/memoryAnalysis.js";
import type * as models_thoughts_memoryEval from "../models/thoughts/memoryEval.js";
import type * as models_thoughts_memoryLifecycle from "../models/thoughts/memoryLifecycle.js";
import type * as models_thoughts_migrations from "../models/thoughts/migrations.js";
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
  "lib/mcpAuth": typeof lib_mcpAuth;
  "lib/webAuth": typeof lib_webAuth;
  "models/apiKeys/mcpAuth": typeof models_apiKeys_mcpAuth;
  "models/apiKeys/model": typeof models_apiKeys_model;
  "models/apiKeys/private": typeof models_apiKeys_private;
  "models/apiKeys/public": typeof models_apiKeys_public;
  "models/apiKeys/validators": typeof models_apiKeys_validators;
  "models/facts/mcpActions": typeof models_facts_mcpActions;
  "models/facts/mcpQueries": typeof models_facts_mcpQueries;
  "models/facts/model": typeof models_facts_model;
  "models/facts/private": typeof models_facts_private;
  "models/facts/public": typeof models_facts_public;
  "models/facts/validators": typeof models_facts_validators;
  "models/lists/mcpActions": typeof models_lists_mcpActions;
  "models/lists/mcpQueries": typeof models_lists_mcpQueries;
  "models/lists/model": typeof models_lists_model;
  "models/lists/private": typeof models_lists_private;
  "models/lists/public": typeof models_lists_public;
  "models/lists/validators": typeof models_lists_validators;
  "models/oauth/mcpMutations": typeof models_oauth_mcpMutations;
  "models/oauth/validators": typeof models_oauth_validators;
  "models/recallBlend": typeof models_recallBlend;
  "models/reports/mcpActions": typeof models_reports_mcpActions;
  "models/reports/mcpMutations": typeof models_reports_mcpMutations;
  "models/reports/mcpQueries": typeof models_reports_mcpQueries;
  "models/reports/model": typeof models_reports_model;
  "models/reports/private": typeof models_reports_private;
  "models/reports/public": typeof models_reports_public;
  "models/reports/validators": typeof models_reports_validators;
  "models/thoughts/actions": typeof models_thoughts_actions;
  "models/thoughts/classify": typeof models_thoughts_classify;
  "models/thoughts/evalRecall": typeof models_thoughts_evalRecall;
  "models/thoughts/helpers": typeof models_thoughts_helpers;
  "models/thoughts/mcpActions": typeof models_thoughts_mcpActions;
  "models/thoughts/mcpQueries": typeof models_thoughts_mcpQueries;
  "models/thoughts/memoryAnalysis": typeof models_thoughts_memoryAnalysis;
  "models/thoughts/memoryEval": typeof models_thoughts_memoryEval;
  "models/thoughts/memoryLifecycle": typeof models_thoughts_memoryLifecycle;
  "models/thoughts/migrations": typeof models_thoughts_migrations;
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
