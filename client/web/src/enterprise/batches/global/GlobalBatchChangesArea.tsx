import React, { useMemo } from 'react'

import { Routes, Route } from 'react-router-dom'

import { Scalars } from '@sourcegraph/shared/src/graphql-operations'
import { SettingsCascadeProps } from '@sourcegraph/shared/src/settings/settings'
import { TelemetryProps } from '@sourcegraph/shared/src/telemetry/telemetryService'
import { lazyComponent } from '@sourcegraph/shared/src/util/lazyComponent'

import { AuthenticatedUser } from '../../../auth'
import { withAuthenticatedUser } from '../../../auth/withAuthenticatedUser'
import { NotFoundPage } from '../../../components/HeroPage'
import type { BatchChangeClosePageProps } from '../close/BatchChangeClosePage'
import type { CreateBatchChangePageProps } from '../create/CreateBatchChangePage'
import type { BatchChangeDetailsPageProps } from '../detail/BatchChangeDetailsPage'
import { TabName } from '../detail/BatchChangeDetailsTabs'
import type { BatchChangeListPageProps, NamespaceBatchChangeListPageProps } from '../list/BatchChangeListPage'
import type { BatchChangePreviewPageProps } from '../preview/BatchChangePreviewPage'
import { canWriteBatchChanges, NO_ACCESS_BATCH_CHANGES_WRITE, NO_ACCESS_SOURCEGRAPH_COM } from '../utils'

const BatchChangeListPage = lazyComponent<BatchChangeListPageProps, 'BatchChangeListPage'>(
    () => import('../list/BatchChangeListPage'),
    'BatchChangeListPage'
)
const NamespaceBatchChangeListPage = lazyComponent<NamespaceBatchChangeListPageProps, 'NamespaceBatchChangeListPage'>(
    () => import('../list/BatchChangeListPage'),
    'NamespaceBatchChangeListPage'
)
const BatchChangePreviewPage = lazyComponent<BatchChangePreviewPageProps, 'BatchChangePreviewPage'>(
    () => import('../preview/BatchChangePreviewPage'),
    'BatchChangePreviewPage'
)
const CreateBatchChangePage = lazyComponent<CreateBatchChangePageProps, 'CreateBatchChangePage'>(
    () => import('../create/CreateBatchChangePage'),
    'CreateBatchChangePage'
)
const BatchChangeDetailsPage = lazyComponent<BatchChangeDetailsPageProps, 'BatchChangeDetailsPage'>(
    () => import('../detail/BatchChangeDetailsPage'),
    'BatchChangeDetailsPage'
)
const BatchChangeClosePage = lazyComponent<BatchChangeClosePageProps, 'BatchChangeClosePage'>(
    () => import('../close/BatchChangeClosePage'),
    'BatchChangeClosePage'
)

interface Props extends TelemetryProps, SettingsCascadeProps {
    authenticatedUser: AuthenticatedUser | null
    isSourcegraphDotCom: boolean
    isSourcegraphApp: boolean
}

/**
 * The global batch changes area.
 */
export const GlobalBatchChangesArea: React.FunctionComponent<React.PropsWithChildren<Props>> = ({
    authenticatedUser,
    isSourcegraphDotCom,
    isSourcegraphApp,
    ...props
}) => {
    const canCreate: true | string = useMemo(() => {
        if (isSourcegraphDotCom) {
            return NO_ACCESS_SOURCEGRAPH_COM
        }
        if (!canWriteBatchChanges(authenticatedUser)) {
            return NO_ACCESS_BATCH_CHANGES_WRITE
        }
        return true
    }, [isSourcegraphDotCom, authenticatedUser])

    return (
        <div className="w-100">
            <Routes>
                <Route
                    path=""
                    element={
                        <BatchChangeListPage
                            headingElement="h1"
                            canCreate={canCreate}
                            authenticatedUser={authenticatedUser}
                            isSourcegraphDotCom={isSourcegraphDotCom}
                            isSourcegraphApp={isSourcegraphApp}
                            {...props}
                        />
                    }
                />
                {!isSourcegraphDotCom && canCreate === true && (
                    <Route
                        path="create"
                        element={
                            <AuthenticatedCreateBatchChangePage
                                {...props}
                                headingElement="h1"
                                authenticatedUser={authenticatedUser}
                            />
                        }
                    />
                )}
                <Route path="*" element={<NotFoundPage pageType="batch changes" />} key="hardcoded-key" />
            </Routes>
        </div>
    )
}

const AuthenticatedCreateBatchChangePage = withAuthenticatedUser<
    CreateBatchChangePageProps & { authenticatedUser: AuthenticatedUser }
>(props => <CreateBatchChangePage {...props} authenticatedUser={props.authenticatedUser} />)

export interface NamespaceBatchChangesAreaProps extends Props {
    namespaceID: Scalars['ID']
}

export const NamespaceBatchChangesArea = withAuthenticatedUser<
    NamespaceBatchChangesAreaProps & { authenticatedUser: AuthenticatedUser }
>(props => (
    <div className="pb-3">
        <Routes>
            <Route path="apply/:batchSpecID" element={<BatchChangePreviewPage {...props} />} />
            <Route path=":batchChangeName/close" element={<BatchChangeClosePage {...props} />} />
            <Route
                path=":batchChangeName/executions"
                element={<BatchChangeDetailsPage {...props} initialTab={TabName.Executions} />}
            />
            <Route path=":batchChangeName" element={<BatchChangeDetailsPage {...props} />} />
            <Route path="" element={<NamespaceBatchChangeListPage headingElement="h2" {...props} />} />
        </Routes>
    </div>
))
