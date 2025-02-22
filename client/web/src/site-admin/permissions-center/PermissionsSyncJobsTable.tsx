import React, { ChangeEvent, FC, useCallback, useEffect, useState } from 'react'

import { ApolloError } from '@apollo/client/errors'
import { mdiCancel, mdiClose, mdiDetails, mdiMapSearch, mdiReload, mdiSecurity } from '@mdi/js'
import classNames from 'classnames'
import { intervalToDuration } from 'date-fns'
import formatDuration from 'date-fns/formatDuration'
import { capitalize, noop } from 'lodash'

import { Timestamp } from '@sourcegraph/branded/src/components/Timestamp'
import { useMutation } from '@sourcegraph/http-client'
import { TelemetryProps } from '@sourcegraph/shared/src/telemetry/telemetryService'
import {
    Alert,
    Button,
    Container,
    H3,
    Icon,
    Input,
    Link,
    Modal,
    PageHeader,
    PageSwitcher,
    Select,
    Text,
    Tooltip,
    useDebounce,
    useLocalStorage,
} from '@sourcegraph/wildcard'

import { usePageSwitcherPagination } from '../../components/FilteredConnection/hooks/usePageSwitcherPagination'
import { ConnectionError, ConnectionLoading } from '../../components/FilteredConnection/ui'
import { PageTitle } from '../../components/PageTitle'
import {
    CancelPermissionsSyncJobResult,
    CancelPermissionsSyncJobResultMessage,
    CancelPermissionsSyncJobVariables,
    CodeHostState,
    PermissionsSyncJob,
    PermissionsSyncJobReasonGroup,
    PermissionsSyncJobsResult,
    PermissionsSyncJobsSearchType,
    PermissionsSyncJobState,
    PermissionsSyncJobsVariables,
    ScheduleRepoPermissionsSyncResult,
    ScheduleRepoPermissionsSyncVariables,
    ScheduleUserPermissionsSyncResult,
    ScheduleUserPermissionsSyncVariables,
} from '../../graphql-operations'
import { useURLSyncedState } from '../../hooks'
import { IColumn, Table } from '../UserManagement/components/Table'

import {
    CANCEL_PERMISSIONS_SYNC_JOB,
    PERMISSIONS_SYNC_JOBS_QUERY,
    TRIGGER_REPO_SYNC,
    TRIGGER_USER_SYNC,
} from './backend'
import {
    JOB_STATE_METADATA_MAPPING,
    PermissionsSyncJobNumbers,
    PermissionsSyncJobReasonByline,
    PermissionsSyncJobStatusBadge,
    PermissionsSyncJobSubject,
} from './PermissionsSyncJobNode'

import styles from './styles.module.scss'

interface Filters {
    reason: string
    state: string
    searchType: string
    query: string
}

interface Notification {
    text: React.ReactNode
    isError?: boolean
}

const DEFAULT_FILTERS = {
    reason: '',
    state: '',
    searchType: '',
    query: '',
}
const PERMISSIONS_SYNC_JOBS_POLL_INTERVAL = 5000

interface Props extends TelemetryProps {
    minimal?: boolean
    userID?: string
    repoID?: string
}

export const PermissionsSyncJobsTable: React.FunctionComponent<React.PropsWithChildren<Props>> = ({
    telemetryService,
    minimal = false,
    userID,
    repoID,
}) => {
    useEffect(() => {
        telemetryService.logPageView('PermissionsSyncJobsTable')
    }, [telemetryService])

    const [filters, setFilters] = useURLSyncedState(DEFAULT_FILTERS)
    const debouncedQuery = useDebounce(filters.query, 300)
    const [polling, setPolling] = useLocalStorage<boolean>('polling_for_permissions_sync_jobs', true)
    const [showModal, setShowModal] = useState<boolean>(false)
    const [selectedJob, setSelectedJob] = useState<PermissionsSyncJob | undefined>(undefined)

    const { connection, loading, startPolling, stopPolling, error, variables, ...paginationProps } =
        usePageSwitcherPagination<PermissionsSyncJobsResult, PermissionsSyncJobsVariables, PermissionsSyncJob>({
            query: PERMISSIONS_SYNC_JOBS_QUERY,
            variables: {
                first: 20,
                reasonGroup: stringToReason(filters.reason),
                state: stringToState(filters.state),
                searchType: stringToSearchType(filters.searchType),
                query: debouncedQuery,
                userID,
                repoID,
            } as PermissionsSyncJobsVariables,
            getConnection: ({ data }) => data?.permissionsSyncJobs || undefined,
            // always do polling if minimal
            options: { pollInterval: minimal ? PERMISSIONS_SYNC_JOBS_POLL_INTERVAL : undefined },
        })

    useEffect(() => {
        if (minimal) {
            return
        }

        if (polling) {
            startPolling(PERMISSIONS_SYNC_JOBS_POLL_INTERVAL)
        } else {
            stopPolling()
        }
    }, [polling, stopPolling, startPolling, minimal])

    const setReason = useCallback(
        (reasonGroup: PermissionsSyncJobReasonGroup | null) => setFilters({ reason: reasonGroup?.toString() || '' }),
        [setFilters]
    )
    const setState = useCallback(
        (state: PermissionsSyncJobState | null) => setFilters({ state: state?.toString() || '' }),
        [setFilters]
    )
    const setSearchType = useCallback(
        (searchType: PermissionsSyncJobsSearchType | null) => setFilters({ searchType: searchType?.toString() || '' }),
        [setFilters]
    )

    const [notification, setNotification] = useState<Notification | undefined>(undefined)
    const dismissNotification = useCallback(() => setNotification(undefined), [])

    const [triggerUserSync] = useMutation<ScheduleUserPermissionsSyncResult, ScheduleUserPermissionsSyncVariables>(
        TRIGGER_USER_SYNC
    )
    const [triggerRepoSync] = useMutation<ScheduleRepoPermissionsSyncResult, ScheduleRepoPermissionsSyncVariables>(
        TRIGGER_REPO_SYNC
    )
    const [cancelSyncJob] = useMutation<CancelPermissionsSyncJobResult, CancelPermissionsSyncJobVariables>(
        CANCEL_PERMISSIONS_SYNC_JOB
    )

    const onError = (error: ApolloError): void => setNotification({ text: error.message, isError: true })

    const handleTriggerPermsSync = useCallback(
        ([job]: PermissionsSyncJob[]) => {
            if (job.subject.__typename === 'Repository') {
                triggerRepoSync({
                    variables: { repo: job.subject.id },
                    onCompleted: () => setNotification({ text: 'Repository permissions sync successfully scheduled' }),
                    onError,
                }).catch(
                    // noop here is used because an error is handled in `onError` option of `useMutation` above.
                    noop
                )
            } else {
                triggerUserSync({
                    variables: { user: job.subject.id },
                    onCompleted: () => setNotification({ text: 'User permissions sync successfully scheduled' }),
                    onError,
                }).catch(
                    // noop here is used because an error is handled in `onError` option of `useMutation` above.
                    noop
                )
            }
        },
        [triggerUserSync, triggerRepoSync]
    )

    const handleCancelSyncJob = useCallback(
        ([syncJob]: PermissionsSyncJob[]) => {
            cancelSyncJob({
                variables: { job: syncJob.id },
                onCompleted: ({ cancelPermissionsSyncJob }) =>
                    setNotification({ text: prettyPrintCancelSyncJobMessage(cancelPermissionsSyncJob) }),
                onError,
            }).catch(
                // noop here is used because an error is handled in `onError` option of `useMutation` above.
                noop
            )
        },
        [cancelSyncJob]
    )

    const handleViewJobDetails = useCallback(
        ([syncJob]: PermissionsSyncJob[]) => {
            setShowModal(true)
            setSelectedJob(syncJob)
        },
        [setShowModal, setSelectedJob]
    )

    if (minimal) {
        return (
            <>
                {error && <ConnectionError errors={[error.message]} />}
                {!connection && <ConnectionLoading />}
                {connection?.nodes?.length === 0 && <EmptyList />}
                {!!connection?.nodes?.length && (
                    <Table<PermissionsSyncJob>
                        columns={TableColumns}
                        getRowId={node => node.id}
                        data={connection.nodes}
                        rowClassName={styles.tableRow}
                    />
                )}
                <PageSwitcher
                    {...paginationProps}
                    className="mt-4"
                    totalCount={connection?.totalCount ?? null}
                    totalLabel="permissions sync jobs"
                />
            </>
        )
    }

    return (
        <div>
            <PageTitle title="Permissions - Admin" />
            <PageHeader
                path={[{ text: 'Permissions' }]}
                headingElement="h2"
                description={
                    <>
                        List of permissions sync jobs. A permission sync job fetches the newest permissions for a given
                        repository or user from the respective code host. Learn more about{' '}
                        <Link to="/help/admin/permissions/syncing">permissions syncing</Link>.
                    </>
                }
                actions={
                    <Tooltip
                        content={
                            polling
                                ? 'Pausing polling will stop the automatic update of the jobs list on this page until polling is resumed.'
                                : 'Resume polling to automatic update the jobs list on this page.'
                        }
                    >
                        <Button variant="secondary" onClick={() => setPolling(oldValue => !oldValue)}>
                            {polling ? 'Pause polling' : 'Resume polling'}
                        </Button>
                    </Tooltip>
                }
                className={classNames(styles.pageHeader, 'mb-3')}
            />
            {showModal && selectedJob && renderModal(selectedJob, () => setShowModal(false))}
            <Container>
                {error && <ConnectionError errors={[error.message]} />}
                {!connection && <ConnectionLoading />}
                {connection?.nodes && (
                    <div className={styles.filtersGrid}>
                        <PermissionsSyncJobReasonGroupPicker value={filters.reason} onChange={setReason} />
                        <PermissionsSyncJobStatePicker value={filters.state} onChange={setState} />
                        <PermissionsSyncJobSearchTypePicker value={filters.searchType} onChange={setSearchType} />
                        <PermissionsSyncJobSearchPane filters={filters} setFilters={setFilters} />
                    </div>
                )}
                {notification && (
                    <Alert
                        className="mt-2 d-flex justify-content-between align-items-center"
                        variant={notification.isError ? 'danger' : 'success'}
                    >
                        {notification.text}
                        <Button variant="secondary" outline={true} onClick={dismissNotification}>
                            <Icon aria-label="Close notification" svgPath={mdiClose} />
                        </Button>
                    </Alert>
                )}
                {connection?.nodes?.length === 0 && <EmptyList />}
                {!!connection?.nodes?.length && (
                    <Table<PermissionsSyncJob>
                        columns={TableColumns}
                        getRowId={node => node.id}
                        data={connection.nodes}
                        rowClassName={styles.tableRow}
                        actions={[
                            {
                                key: 'Re-trigger job',
                                label: 'Re-trigger job',
                                icon: mdiReload,
                                onClick: handleTriggerPermsSync,
                                condition: ([node]) => finalState(node.state),
                            },
                            {
                                key: 'Cancel job',
                                label: 'Cancel job',
                                icon: mdiCancel,
                                onClick: handleCancelSyncJob,
                                condition: ([node]) => node.state === PermissionsSyncJobState.QUEUED,
                            },
                            {
                                key: 'View Permissions',
                                label: 'View Permissions',
                                icon: mdiSecurity,
                                href: ([node]) =>
                                    node.subject.__typename === 'Repository'
                                        ? node.subject.url + '/-/settings/permissions'
                                        : `/users/${node.subject.username}/settings/permissions`,
                                target: '_blank',
                            },
                            {
                                key: 'View Job Details',
                                label: 'View Job Details',
                                icon: mdiDetails,
                                onClick: handleViewJobDetails,
                            },
                        ]}
                    />
                )}
                <PageSwitcher
                    {...paginationProps}
                    className="mt-4"
                    totalCount={connection?.totalCount ?? null}
                    totalLabel="permissions sync jobs"
                />
            </Container>
        </div>
    )
}

const TableColumns: IColumn<PermissionsSyncJob>[] = [
    {
        key: 'Status',
        header: 'Status',
        render: ({ state, cancellationReason, failureMessage }: PermissionsSyncJob) => (
            <PermissionsSyncJobStatusBadge
                state={state}
                cancellationReason={cancellationReason}
                failureMessage={failureMessage}
            />
        ),
    },
    {
        key: 'Name',
        header: 'Name',
        render: (node: PermissionsSyncJob) => <PermissionsSyncJobSubject job={node} />,
        cellClassName: classNames(styles.subjectContainer, 'pr-1'),
    },
    {
        key: 'Reason',
        header: 'Reason',
        render: (node: PermissionsSyncJob) => <PermissionsSyncJobReasonByline job={node} />,
        cellClassName: classNames(styles.reasonGroupContainer, 'pr-1'),
    },
    {
        key: 'Added',
        header: 'Added',
        align: 'right',
        render: (node: PermissionsSyncJob) => <PermissionsSyncJobNumbers job={node} added={true} />,
    },
    {
        key: 'Removed',
        header: 'Removed',
        align: 'right',
        render: (node: PermissionsSyncJob) => <PermissionsSyncJobNumbers job={node} added={false} />,
    },
    {
        key: 'Total',
        header: 'Total',
        align: 'right',
        render: ({ permissionsFound }: PermissionsSyncJob) => (
            <div className="text-muted text-right mr-2">
                <b>{permissionsFound}</b>
            </div>
        ),
    },
]

const stringToReason = (reason: string): PermissionsSyncJobReasonGroup | null =>
    reason === '' ? null : PermissionsSyncJobReasonGroup[reason as keyof typeof PermissionsSyncJobReasonGroup]

const stringToState = (state: string): PermissionsSyncJobState | null =>
    state === '' ? null : PermissionsSyncJobState[state as keyof typeof PermissionsSyncJobState]

const stringToSearchType = (searchType: string): PermissionsSyncJobsSearchType | null =>
    searchType === '' ? null : PermissionsSyncJobsSearchType[searchType as keyof typeof PermissionsSyncJobsSearchType]

interface PermissionsSyncJobReasonGroupPickerProps {
    value: string
    onChange: (reasonGroup: PermissionsSyncJobReasonGroup | null) => void
}

const PermissionsSyncJobReasonGroupPicker: FC<PermissionsSyncJobReasonGroupPickerProps> = props => {
    const { onChange, value } = props

    const handleSelect = (event: ChangeEvent<HTMLSelectElement>): void => {
        const nextValue = event.target.value === '' ? null : (event.target.value as PermissionsSyncJobReasonGroup)
        onChange(nextValue)
    }

    return (
        <Select id="reasonSelector" value={stringToReason(value) || ''} label="Reason" onChange={handleSelect}>
            <option value="">Any</option>
            <option value={PermissionsSyncJobReasonGroup.MANUAL}>Manual</option>
            <option value={PermissionsSyncJobReasonGroup.SCHEDULE}>Schedule</option>
            <option value={PermissionsSyncJobReasonGroup.SOURCEGRAPH}>Sourcegraph</option>
            <option value={PermissionsSyncJobReasonGroup.WEBHOOK}>Webhook</option>
        </Select>
    )
}

interface PermissionsSyncJobStatePickerProps {
    value: string
    onChange: (state: PermissionsSyncJobState | null) => void
}

const PermissionsSyncJobStatePicker: FC<PermissionsSyncJobStatePickerProps> = props => {
    const { onChange, value } = props

    const handleSelect = (event: ChangeEvent<HTMLSelectElement>): void => {
        const nextValue = event.target.value === '' ? null : (event.target.value as PermissionsSyncJobState)
        onChange(nextValue)
    }

    return (
        <Select id="stateSelector" value={stringToState(value) || ''} label="State" onChange={handleSelect}>
            <option value="">Any</option>
            <option value={PermissionsSyncJobState.CANCELED}>Canceled</option>
            <option value={PermissionsSyncJobState.COMPLETED}>Completed</option>
            <option value={PermissionsSyncJobState.ERRORED}>Errored</option>
            <option value={PermissionsSyncJobState.FAILED}>Failed</option>
            <option value={PermissionsSyncJobState.PROCESSING}>Processing</option>
            <option value={PermissionsSyncJobState.QUEUED}>Queued</option>
        </Select>
    )
}

interface PermissionsSyncJobSearchTypePickerProps {
    value: string
    onChange: (searchType: PermissionsSyncJobsSearchType | null) => void
}

const PermissionsSyncJobSearchTypePicker: FC<PermissionsSyncJobSearchTypePickerProps> = props => {
    const { onChange, value } = props

    const handleSelect = (event: ChangeEvent<HTMLSelectElement>): void => {
        const nextValue = event.target.value === '' ? null : (event.target.value as PermissionsSyncJobsSearchType)
        onChange(nextValue)
    }

    return (
        <Select id="searchTypeSelector" value={stringToSearchType(value) || ''} label="Search" onChange={handleSelect}>
            <option value="">Choose User/Repository</option>
            <option value={PermissionsSyncJobsSearchType.USER}>User</option>
            <option value={PermissionsSyncJobsSearchType.REPOSITORY}>Repository</option>
        </Select>
    )
}

interface PermissionsSyncJobSearchPaneProps {
    filters: Filters
    setFilters: (data: Partial<Filters>) => void
}

const PermissionsSyncJobSearchPane: FC<PermissionsSyncJobSearchPaneProps> = props => {
    const { filters, setFilters } = props

    return (
        <Tooltip content={filters.searchType === '' ? 'First select the search context on the left.' : undefined}>
            <Input
                type="search"
                placeholder={
                    filters.searchType === ''
                        ? 'Select a search context'
                        : filters.searchType === PermissionsSyncJobsSearchType.USER
                        ? 'Search users...'
                        : 'Search repositories...'
                }
                name="query"
                value={filters.query}
                onChange={event => setFilters({ ...filters, query: event.currentTarget.value })}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-label="Search sync jobs..."
                variant="regular"
                disabled={filters.searchType === ''}
                className={styles.searchInput}
            />
        </Tooltip>
    )
}

const EmptyList: React.FunctionComponent<React.PropsWithChildren<{}>> = () => (
    <div className="text-muted text-center mb-3 w-100">
        <Icon className="icon" svgPath={mdiMapSearch} inline={false} aria-hidden={true} />
        <div className="pt-2">No permissions sync jobs have been found.</div>
    </div>
)

const finalState = (state: PermissionsSyncJobState): boolean =>
    state !== PermissionsSyncJobState.QUEUED && state !== PermissionsSyncJobState.PROCESSING

const prettyPrintCancelSyncJobMessage = (message: CancelPermissionsSyncJobResultMessage): string => {
    switch (message) {
        case CancelPermissionsSyncJobResultMessage.SUCCESS:
            return 'Permissions sync job canceled.'
        case CancelPermissionsSyncJobResultMessage.NOT_FOUND:
            return 'Permissions sync job is already dequeued and cannot be canceled.'
        case CancelPermissionsSyncJobResultMessage.ERROR:
            return 'Error during permissions sync job cancelling.'
    }
}

const CodeHostStatesTableColumns: IColumn<CodeHostState>[] = [
    {
        key: 'ProviderID',
        header: 'Provider ID',
        render: (state: CodeHostState) => <Text>{state.providerID}</Text>,
    },
    {
        key: 'ProviderType',
        header: 'Provider Type',
        render: (state: CodeHostState) => <Text>{capitalize(state.providerType)}</Text>,
    },
    {
        key: 'Status',
        header: 'Status',
        render: (state: CodeHostState) => <Text>{capitalize(state.status)}</Text>,
    },
]

const renderModal = (job: PermissionsSyncJob, hideModal: () => void): React.ReactNode => (
    <Modal onDismiss={hideModal} aria-labelledby="permissions-sync-job-modal">
        {job.cancellationReason && <Alert variant="info">Cancellation reason: {job.cancellationReason}</Alert>}
        {job.failureMessage && <Alert variant="danger">{job.failureMessage}</Alert>}
        <div className={classNames(styles.modalGrid, 'mb-2')}>
            <Text className="mb-0" weight="bold">
                Queued at
            </Text>
            <Timestamp date={job.queuedAt} preferAbsolute={true} />

            {job.startedAt && (
                <>
                    <Text className="mb-0" weight="bold">
                        Started at
                    </Text>
                    <Timestamp date={job.startedAt} preferAbsolute={true} />
                </>
            )}

            {job.finishedAt && (
                <>
                    <Text className="mb-0" weight="bold">
                        {JOB_STATE_METADATA_MAPPING[job.state].temporalWording} at
                    </Text>
                    <Timestamp date={job.finishedAt} preferAbsolute={true} />
                </>
            )}

            {job.ranForMs !== null && job.ranForMs > 0 && (
                <>
                    <Text className="mb-0" weight="bold">
                        Ran for
                    </Text>
                    <Text className="mb-0">
                        {job.ranForMs < 1000
                            ? `${job.ranForMs}ms`
                            : formatDuration(intervalToDuration({ start: 0, end: job.ranForMs }))}
                    </Text>
                </>
            )}

            {finalState(job.state) && (
                <>
                    <Text className="mb-0" weight="bold">
                        Permissions added
                    </Text>
                    <Text className="mb-0">{job.permissionsAdded}</Text>

                    <Text className="mb-0" weight="bold">
                        Permissions removed
                    </Text>
                    <Text className="mb-0">{job.permissionsRemoved}</Text>

                    <Text className="mb-0" weight="bold">
                        Permissions found
                    </Text>
                    <Text className="mb-0">{job.permissionsFound}</Text>
                </>
            )}
        </div>
        {job.codeHostStates?.length > 0 && (
            <div className="mt-4">
                <H3>Permissions providers information</H3>
                <Table<CodeHostState>
                    columns={CodeHostStatesTableColumns}
                    data={job.codeHostStates}
                    getRowId={state => state.providerID}
                />
            </div>
        )}
    </Modal>
)
