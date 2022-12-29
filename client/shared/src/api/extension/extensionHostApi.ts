import { proxy } from 'comlink'
import { castArray, isEqual } from 'lodash'
import { combineLatest, concat, Observable, of, throwError } from 'rxjs'
import { catchError, debounceTime, defaultIfEmpty, distinctUntilChanged, map, switchMap } from 'rxjs/operators'
import { ProviderResult } from 'sourcegraph'

import {
    fromHoverMerged,
    TextDocumentIdentifier,
    ContributableViewContainer,
    TextDocumentPositionParameters,
} from '@sourcegraph/client-api'
import { LOADING, MaybeLoadingResult } from '@sourcegraph/codeintellify'
import {
    allOf,
    asError,
    combineLatestOrDefault,
    ErrorLike,
    isDefined,
    isExactly,
    isNot,
    logger,
    property,
} from '@sourcegraph/common'
import * as clientType from '@sourcegraph/extension-api-types'

import type {
    ReferenceContext,
    DocumentSelector,
    DirectoryViewContext,
    View,
    PanelView,
} from '../../codeintel/legacy-extensions/api'
import { getModeFromPath } from '../../languages'
import { parseRepoURI } from '../../util/url'
import { match } from '../client/types/textDocument'
import { FlatExtensionHostAPI } from '../contract'
import { ExtensionViewer, ViewerId, ViewerWithPartialModel } from '../viewerTypes'

import { ExtensionCodeEditor } from './api/codeEditor'
import { providerResultToObservable, proxySubscribable } from './api/common'
import { filterContributions, mergeContributions } from './api/contribution'
import { ExtensionDirectoryViewer } from './api/directoryViewer'
import { getInsightsViews } from './api/getInsightsViews'
import { ExtensionDocument } from './api/textDocument'
import { fromLocation, toPosition } from './api/types'
import { ExtensionWorkspaceRoot } from './api/workspaceRoot'
import { ExtensionHostState } from './extensionHostState'
import { addWithRollback } from './util'

export function createExtensionHostAPI(state: ExtensionHostState): FlatExtensionHostAPI {
    const getTextDocument = (uri: string): ExtensionDocument => {
        const textDocument = state.textDocuments.get(uri)
        if (!textDocument) {
            throw new Error(`Text document does not exist with URI ${uri}`)
        }
        return textDocument
    }

    /**
     * Removes a model.
     *
     * @param uri The URI of the model to remove.
     */
    const removeTextDocument = (uri: string): void => {
        const model = getTextDocument(uri)
        state.textDocuments.delete(uri)
        if (state.languageReferences.decrement(model.languageId)) {
            state.activeLanguages.next(new Set<string>(state.languageReferences.keys()))
        }
    }

    /**
     * Returns the Viewer with the given viewerId.
     * Throws if no viewer exists with the given viewerId.
     */
    const getViewer = (viewerId: ViewerId['viewerId']): ExtensionViewer => {
        const viewer = state.viewComponents.get(viewerId)
        if (!viewer) {
            throw new ViewerNotFoundError(viewerId)
        }
        return viewer
    }

    const exposedToMain: FlatExtensionHostAPI = {
        haveInitialExtensionsLoaded: () => proxySubscribable(state.haveInitialExtensionsLoaded.asObservable()),

        // Configuration
        syncSettingsData: settings => state.settings.next(Object.freeze(settings)),

        // Workspace
        getWorkspaceRoots: () =>
            proxySubscribable(
                state.roots.pipe(
                    map(workspaceRoots =>
                        workspaceRoots.map(
                            ({ uri, inputRevision }): clientType.WorkspaceRoot => ({ uri: uri.href, inputRevision })
                        )
                    )
                )
            ),
        addWorkspaceRoot: root => {
            state.roots.next(Object.freeze([...state.roots.value, new ExtensionWorkspaceRoot(root)]))
            state.rootChanges.next()
        },
        removeWorkspaceRoot: uri => {
            state.roots.next(Object.freeze(state.roots.value.filter(workspace => workspace.uri.href !== uri)))
            state.rootChanges.next()
        },
        setSearchContext: context => {
            state.searchContext = context
            state.searchContextChanges.next(context)
        },

        // Language
        getHover: (textParameters: TextDocumentPositionParameters) => {
            const document = getTextDocument(textParameters.textDocument.uri)
            const position = toPosition(textParameters.position)

            return proxySubscribable(
                callProviders(
                    state.hoverProviders,
                    providers => providersForDocument(document, providers, ({ selector }) => selector),
                    ({ provider }) => provider.provideHover(document, position),
                    results => fromHoverMerged(mergeProviderResults(results))
                )
            )
        },
        getDocumentHighlights: (textParameters: TextDocumentPositionParameters) => {
            const document = getTextDocument(textParameters.textDocument.uri)
            const position = toPosition(textParameters.position)

            return proxySubscribable(
                callProviders(
                    state.documentHighlightProviders,
                    providers => providersForDocument(document, providers, ({ selector }) => selector),
                    ({ provider }) => provider.provideDocumentHighlights(document, position),
                    mergeProviderResults
                ).pipe(map(result => (result.isLoading ? [] : result.result)))
            )
        },
        getDefinition: (textParameters: TextDocumentPositionParameters) => {
            const document = getTextDocument(textParameters.textDocument.uri)
            const position = toPosition(textParameters.position)

            return proxySubscribable(
                callProviders(
                    state.definitionProviders,
                    providers => providersForDocument(document, providers, ({ selector }) => selector),
                    ({ provider }) => provider.provideDefinition(document, position),
                    results => mergeProviderResults(results).map(fromLocation)
                )
            )
        },
        getReferences: (textParameters: TextDocumentPositionParameters, context: ReferenceContext) => {
            const document = getTextDocument(textParameters.textDocument.uri)
            const position = toPosition(textParameters.position)

            return proxySubscribable(
                callProviders(
                    state.referenceProviders,
                    providers => providersForDocument(document, providers, ({ selector }) => selector),
                    ({ provider }) => provider.provideReferences(document, position, context),
                    results => mergeProviderResults(results).map(fromLocation)
                )
            )
        },
        hasReferenceProvidersForDocument: (textParameters: TextDocumentPositionParameters) => {
            const document = getTextDocument(textParameters.textDocument.uri)

            return proxySubscribable(
                state.referenceProviders.pipe(
                    map(providers => providersForDocument(document, providers, ({ selector }) => selector).length !== 0)
                )
            )
        },

        getLocations: (id: string, textParameters: TextDocumentPositionParameters) => {
            const document = getTextDocument(textParameters.textDocument.uri)
            const position = toPosition(textParameters.position)

            return proxySubscribable(
                callProviders(
                    state.locationProviders,
                    providers =>
                        providersForDocument(
                            document,
                            providers.filter(({ provider }) => id === provider.id),
                            ({ selector }) => selector
                        ),
                    ({ provider }) => provider.provider.provideLocations(document, position),
                    results => mergeProviderResults(results).map(fromLocation)
                )
            )
        },

        // MODELS

        //  TODO(tj): if not exists? doesn't seem that we can guarantee that just based on uri
        addViewerIfNotExists: viewerData => {
            const viewerId = `viewer#${state.lastViewerId++}`
            if (viewerData.type === 'CodeEditor') {
                state.modelReferences.increment(viewerData.resource)
            }
            let viewComponent: ExtensionViewer
            switch (viewerData.type) {
                case 'CodeEditor': {
                    const textDocument = getTextDocument(viewerData.resource)
                    viewComponent = new ExtensionCodeEditor({ ...viewerData, viewerId }, textDocument)
                    break
                }

                case 'DirectoryViewer': {
                    viewComponent = new ExtensionDirectoryViewer({ ...viewerData, viewerId })
                    break
                }
            }

            state.viewComponents.set(viewerId, viewComponent)
            if (viewerData.isActive) {
                state.activeViewComponentChanges.next(viewComponent)
            }
            state.viewerUpdates.next({ viewerId, action: 'addition', type: viewerData.type })
            return { viewerId }
        },

        removeViewer: ({ viewerId }) => {
            const viewer = getViewer(viewerId)
            state.viewComponents.delete(viewerId)
            // Check if this was the active viewer
            if (state.activeViewComponentChanges.value?.viewerId === viewerId) {
                state.activeViewComponentChanges.next(undefined)
            }
            state.viewerUpdates.next({ viewerId, action: 'removal', type: viewer.type })
            if (viewer.type === 'CodeEditor' && state.modelReferences.decrement(viewer.resource)) {
                removeTextDocument(viewer.resource)
            }
        },

        viewerUpdates: () => proxySubscribable(state.viewerUpdates.asObservable()),

        setEditorSelections: ({ viewerId }, selections) => {
            const viewer = getViewer(viewerId)
            assertViewerType(viewer, 'CodeEditor')
            viewer.update({ selections })
        },

        addTextDocumentIfNotExists: textDocumentData => {
            if (state.textDocuments.has(textDocumentData.uri)) {
                return
            }
            const textDocument = new ExtensionDocument(textDocumentData)
            state.textDocuments.set(textDocumentData.uri, textDocument)
            state.openedTextDocuments.next(textDocument)
            // Update activeLanguages if no other existing model has the same language.
            if (state.languageReferences.increment(textDocumentData.languageId)) {
                state.activeLanguages.next(new Set<string>(state.languageReferences.keys()))
            }
        },

        // For filtering visible panels by DocumentSelector
        getActiveViewComponentChanges: () => proxySubscribable(state.activeViewComponentChanges),

        // For panel view location provider arguments
        getActiveCodeEditorPosition: () =>
            proxySubscribable(
                state.activeViewComponentChanges.pipe(
                    switchMap(activeViewer => {
                        if (activeViewer?.type !== 'CodeEditor') {
                            return of(null)
                        }

                        return activeViewer.selectionsChanges.pipe(
                            map(selections => {
                                const sel = selections[0]
                                if (!sel) {
                                    return null
                                }

                                // TODO(sqs): Return null for empty selections (but currently all selected tokens are treated as an empty
                                // selection at the beginning of the token, so this would break a lot of things, so we only do this for empty
                                // selections when the start character is -1). HACK(sqs): Character === -1 means that the whole line is
                                // selected (this is a bug in the caller, but it is useful here).
                                const isEmpty =
                                    sel.start.line === sel.end.line &&
                                    sel.start.character === sel.end.character &&
                                    sel.start.character === -1
                                if (isEmpty) {
                                    return null
                                }

                                return {
                                    textDocument: { uri: activeViewer.resource },
                                    position: { line: sel.start.line, character: sel.start.character },
                                }
                            })
                        )
                    })
                )
            ),

        // Contributions
        registerContributions: rawContributions => proxy(addWithRollback(state.contributions, rawContributions)),
        getContributions: ({ returnInactiveMenuItems }: ContributionOptions = {}) =>
            // TODO(tj): memoize access from mainthread
            proxySubscribable(
                combineLatest([
                    state.contributions,
                    state.activeViewComponentChanges.pipe(
                        map((activeEditor): ViewerWithPartialModel | undefined => {
                            if (!activeEditor) {
                                return undefined
                            }

                            switch (activeEditor.type) {
                                case 'CodeEditor': {
                                    const { languageId } = getTextDocument(activeEditor.resource)
                                    return Object.assign(activeEditor, { model: { languageId } })
                                }
                                case 'DirectoryViewer':
                                    return activeEditor
                            }
                        })
                    ),
                    state.settings,
                ]).pipe(
                    map(([multiContributions]) =>
                        multiContributions.map(contributions => {
                            try {
                                return returnInactiveMenuItems ? contributions : filterContributions(contributions)
                            } catch (error) {
                                // An error during evaluation causes all of the contributions in the same entry to be
                                // discarded.
                                logger.error('Discarding contributions: evaluating expressions or templates failed.', {
                                    contributions,
                                    error,
                                })
                                return {}
                            }
                        })
                    ),
                    map(mergeContributions),
                    distinctUntilChanged(isEqual)
                )
            ),

        // Views
        getPanelViews: () =>
            // Don't need `combineLatestOrDefault` here since each panel view
            // is a BehaviorSubject, and therefore guaranteed to emit
            proxySubscribable(
                state.panelViews.pipe(
                    switchMap(panelViews => combineLatest([...panelViews])),
                    debounceTime(0)
                )
            ),

        // Insight page
        getInsightViewById: (id, context) =>
            proxySubscribable(
                state.insightsPageViewProviders.pipe(
                    switchMap(providers => {
                        const provider = providers.find(provider => {
                            // Get everything until last dot according to extension id naming convention
                            // <type>.<name>.<view type = directory|insightPage|homePage>
                            const providerId = provider.id.split('.').slice(0, -1).join('.')

                            return providerId === id
                        })

                        if (!provider) {
                            return throwError(new Error(`Couldn't find view with id ${id}`))
                        }

                        return providerResultToObservable(provider.viewProvider.provideView(context))
                    }),
                    catchError((error: unknown) => {
                        logger.error('View provider errored:', error)
                        // Pass only primitive copied values because Error object is not
                        // cloneable in Firefox and Safari
                        const { message, name, stack } = asError(error)
                        return of({ message, name, stack } as ErrorLike)
                    }),
                    map(view => ({ id, view }))
                )
            ),

        getInsightsViews: (context, insightIds) =>
            getInsightsViews(context, state.insightsPageViewProviders, insightIds),

        getHomepageViews: context => proxySubscribable(callViewProviders(context, state.homepageViewProviders)),
        getDirectoryViews: context =>
            proxySubscribable(
                callViewProviders(
                    {
                        viewer: {
                            ...context.viewer,
                            directory: {
                                ...context.viewer.directory,
                                uri: new URL(context.viewer.directory.uri),
                            },
                        },
                        workspace: { uri: new URL(context.workspace.uri) },
                    },
                    state.directoryViewProviders
                )
            ),

        getGlobalPageViews: context => proxySubscribable(callViewProviders(context, state.globalPageViewProviders)),

        getActiveExtensions: () => proxySubscribable(state.activeExtensions),
    }

    return exposedToMain
}

export interface RegisteredProvider<T> {
    selector: DocumentSelector
    provider: T
}

// TODO (loic, felix) it might make sense to port tests with the rest of provider registries.
/**
 * Filters a list of Providers (P type) based on their selectors and a document
 *
 * @param document to use for filtering
 * @param entries array of providers (P[])
 * @param selector a way to get a selector from a Provider
 * @returns a filtered array of providers
 */
export function providersForDocument<P>(
    document: TextDocumentIdentifier,
    entries: readonly P[],
    selector: (p: P) => DocumentSelector
): P[] {
    return entries.filter(provider =>
        match(selector(provider), {
            uri: document.uri,
            languageId: getModeFromPath(parseRepoURI(document.uri).filePath || ''),
        })
    )
}

/**
 * Helper function to abstract common logic of invoking language providers.
 *
 * 1. filters providers
 * 2. invokes filtered providers via invokeProvider function
 * 3. adds [LOADING] state for each provider result stream
 * 4. omits errors from provider results with potential logging
 * 5. aggregates latests results from providers based on mergeResult function
 *
 * @param providersObservable observable of provider collection (expected to emit if a provider was added or removed)
 * @param filterProviders specifies which providers should be invoked
 * @param invokeProvider specifies how to get results from a provider (usually a closure over provider arguments)
 * @param mergeResult specifies how providers results should be aggregated
 * @param logErrors if console.error should be used for reporting errors from providers
 * @returns observable of aggregated results from all providers based on mergeProviderResults function
 */
export function callProviders<TRegisteredProvider, TProviderResult, TMergedResult>(
    providersObservable: Observable<readonly TRegisteredProvider[]>,
    filterProviders: (providers: readonly TRegisteredProvider[]) => TRegisteredProvider[],
    invokeProvider: (provider: TRegisteredProvider) => ProviderResult<TProviderResult>,
    mergeResult: (providerResults: readonly (TProviderResult | 'loading' | null | undefined)[]) => TMergedResult,
    logErrors: boolean = true
): Observable<MaybeLoadingResult<TMergedResult>> {
    const logError = (...args: any): void => {
        if (logErrors) {
            logger.error('Provider errored:', ...args)
        }
    }
    const safeInvokeProvider = (provider: TRegisteredProvider): ProviderResult<TProviderResult> => {
        try {
            return invokeProvider(provider)
        } catch (error) {
            logError(error)
            return null
        }
    }

    return providersObservable
        .pipe(
            map(providers => filterProviders(providers)),

            switchMap(providers =>
                combineLatestOrDefault(
                    providers.map(provider =>
                        concat(
                            [LOADING],
                            providerResultToObservable(safeInvokeProvider(provider)).pipe(
                                defaultIfEmpty<typeof LOADING | TProviderResult | null | undefined>(null),
                                catchError(error => {
                                    logError(error)
                                    return [null]
                                })
                            )
                        )
                    )
                )
            )
        )
        .pipe(
            defaultIfEmpty<(typeof LOADING | TProviderResult | null | undefined)[]>([]),
            map(results => ({
                isLoading: results.some(hover => hover === LOADING),
                result: mergeResult(results),
            })),
            distinctUntilChanged((a, b) => isEqual(a, b))
        )
}

/**
 * Merges provider results
 *
 * @param results latest results from providers
 * @template TProviderResultElement Type of an element of the provider result array
 */
export function mergeProviderResults<TProviderResultElement>(
    results: readonly (typeof LOADING | TProviderResultElement | TProviderResultElement[] | null | undefined)[]
): TProviderResultElement[] {
    return results
        .filter(isNot(isExactly(LOADING)))
        .flatMap(castArray)
        .filter(isDefined)
}

// Viewers + documents

const VIEWER_NOT_FOUND_ERROR_NAME = 'ViewerNotFoundError'
class ViewerNotFoundError extends Error {
    public readonly name = VIEWER_NOT_FOUND_ERROR_NAME
    constructor(viewerId: string) {
        super(`Viewer not found: ${viewerId}`)
    }
}

function assertViewerType<T extends ExtensionViewer['type']>(
    viewer: ExtensionViewer,
    type: T
): asserts viewer is ExtensionViewer & { type: T } {
    if (viewer.type !== type) {
        throw new Error(`Viewer ID ${viewer.viewerId} is type ${viewer.type}, expected ${type}`)
    }
}

// Views

/**
 * A map from type of container names to the internal type of the context parameter provided by the container.
 */
export interface ViewContexts {
    [ContributableViewContainer.Panel]: never
    [ContributableViewContainer.Homepage]: {}
    [ContributableViewContainer.InsightsPage]: {}
    [ContributableViewContainer.GlobalPage]: Record<string, string>
    [ContributableViewContainer.Directory]: DirectoryViewContext
}

export interface RegisteredViewProvider<W extends ContributableViewContainer> {
    id: string
    viewProvider: {
        provideView: (context: ViewContexts[W]) => ProviderResult<View>
    }
}

function callViewProviders<W extends ContributableViewContainer>(
    context: ViewContexts[W],
    providers: Observable<readonly RegisteredViewProvider<W>[]>
): Observable<ViewProviderResult[]> {
    return providers.pipe(
        debounceTime(0),
        switchMap(providers =>
            combineLatest([
                of(null),
                ...providers.map(({ viewProvider, id }) =>
                    concat(
                        [undefined],
                        providerResultToObservable(viewProvider.provideView(context)).pipe(
                            defaultIfEmpty<View | null | undefined>(null),
                            catchError((error: unknown): [ErrorLike] => {
                                logger.error('View provider errored:', error)
                                // Pass only primitive copied values because Error object is not
                                // cloneable in Firefox and Safari
                                const { message, name, stack } = asError(error)
                                return [{ message, name, stack } as ErrorLike]
                            })
                        )
                    ).pipe(map(view => ({ id, view })))
                ),
            ])
        ),
        map(views => views.filter(allOf(isDefined, property('view', isNot(isExactly(null))))))
    )
}

/**
 * A workspace root with additional metadata that is not exposed to extensions.
 */
export interface WorkspaceRootWithMetadata extends clientType.WorkspaceRoot {
    /**
     * The original input Git revision that the user requested. The {@link WorkspaceRoot#uri} value will contain
     * the Git commit SHA resolved from the input revision, but it is useful to also know the original revision
     * (e.g., to construct URLs for the user that don't result in them navigating from a branch view to a commit
     * SHA view).
     *
     * For example, if the user is viewing the web page https://github.com/alice/myrepo/blob/master/foo.js (note
     * that the URL contains a Git revision "master"), the input revision is "master".
     *
     * The empty string is a valid value (meaning that the default should be used, such as "HEAD" in Git) and is
     * distinct from undefined. If undefined, the Git commit SHA from {@link WorkspaceRoot#uri} should be used.
     */
    inputRevision?: string
}

/** @internal */
export interface PanelViewData extends Omit<PanelView, 'unsubscribe'> {
    id: string
}

export interface ViewProviderResult {
    /** The ID of the view provider. */
    id: string

    /** The result returned by the provider. */
    view: View | undefined | ErrorLike
}

// Contributions

export interface ContributionOptions {
    returnInactiveMenuItems?: boolean
}
