import React, { useCallback, useState } from 'react'

import { mdiAccount, mdiChevronDown } from '@mdi/js'
import classNames from 'classnames'

import { Timestamp } from '@sourcegraph/branded/src/components/Timestamp'
import {
    Badge,
    BADGE_VARIANTS,
    Button,
    Icon,
    Link,
    Popover,
    PopoverContent,
    PopoverOpenEvent,
    PopoverTrigger,
    Position,
    Text,
    Tooltip,
} from '@sourcegraph/wildcard'

import {
    PermissionsSyncJob,
    PermissionsSyncJobReason,
    PermissionsSyncJobReasonGroup,
    PermissionsSyncJobState,
} from '../../graphql-operations'
import { ExternalRepositoryIcon } from '../components/ExternalRepositoryIcon'

import styles from './styles.module.scss'

export interface ChangesetCloseNodeProps {
    node: PermissionsSyncJob
}

interface JobStateMetadata {
    badgeVariant: typeof BADGE_VARIANTS[number]
    temporalWording: string
    timeGetter: (job: PermissionsSyncJob) => string
}

const JOB_REASON_TO_READABLE_REASON: Record<PermissionsSyncJobReason, string> = {
    REASON_GITHUB_ORG_MEMBER_ADDED_EVENT: 'Team member added',
    REASON_GITHUB_ORG_MEMBER_REMOVED_EVENT: 'Team member removed',
    REASON_GITHUB_REPO_EVENT: 'Repository event',
    REASON_GITHUB_REPO_MADE_PRIVATE_EVENT: 'Repository made private',
    REASON_GITHUB_TEAM_ADDED_TO_REPO_EVENT: 'Team added to repository',
    REASON_GITHUB_TEAM_REMOVED_FROM_REPO_EVENT: 'Team removed from repository',
    REASON_GITHUB_USER_ADDED_EVENT: 'User added',
    REASON_GITHUB_USER_EVENT: 'User event',
    REASON_GITHUB_USER_MEMBERSHIP_ADDED_EVENT: 'User membership added',
    REASON_GITHUB_USER_MEMBERSHIP_REMOVED_EVENT: 'User membership removed',
    REASON_GITHUB_USER_REMOVED_EVENT: 'User removed',
    REASON_MANUAL_REPO_SYNC: 'Repository synchronization triggered manually',
    REASON_MANUAL_USER_SYNC: 'User synchronization triggered manually',
    REASON_REPO_NO_PERMS: 'Repository has no permissions',
    REASON_REPO_OUTDATED_PERMS: 'Regular refresh of repository permissions',
    REASON_REPO_UPDATED_FROM_CODE_HOST: 'Repository has been updated from code host',
    REASON_USER_ACCEPTED_ORG_INVITE: 'User accepted organization invite',
    REASON_USER_ADDED_TO_ORG: 'User added to organization',
    REASON_USER_EMAIL_REMOVED: 'User email removed',
    REASON_USER_EMAIL_VERIFIED: 'User email verified',
    REASON_USER_NO_PERMS: 'User had no permissions',
    REASON_USER_OUTDATED_PERMS: 'Regular refresh of user permissions',
    REASON_USER_REMOVED_FROM_ORG: 'User removed from organization',
}

export const JOB_STATE_METADATA_MAPPING: Record<PermissionsSyncJobState, JobStateMetadata> = {
    QUEUED: {
        badgeVariant: 'secondary',
        temporalWording: 'Queued',
        timeGetter: job => job.queuedAt,
    },
    PROCESSING: {
        badgeVariant: 'primary',
        temporalWording: 'Began processing',
        timeGetter: job => job.startedAt ?? '',
    },
    COMPLETED: {
        badgeVariant: 'success',
        temporalWording: 'Completed',
        timeGetter: job => job.finishedAt ?? '',
    },
    ERRORED: {
        badgeVariant: 'danger',
        temporalWording: 'Errored',
        timeGetter: job => job.finishedAt ?? '',
    },
    FAILED: {
        badgeVariant: 'danger',
        temporalWording: 'Failed',
        timeGetter: job => job.finishedAt ?? '',
    },
    CANCELED: {
        badgeVariant: 'outlineSecondary',
        temporalWording: 'Canceled',
        timeGetter: job => job.finishedAt ?? '',
    },
}

interface PermissionsSyncJobStatusBadgeProps {
    state: PermissionsSyncJobState
    cancellationReason: string | null
    failureMessage: string | null
}

export const PermissionsSyncJobStatusBadge: React.FunctionComponent<PermissionsSyncJobStatusBadgeProps> = ({
    state,
    cancellationReason,
    failureMessage,
}) => (
    <Badge
        className={classNames(styles.statusContainer, 'mr-1')}
        tooltip={cancellationReason ?? failureMessage ?? undefined}
        variant={JOB_STATE_METADATA_MAPPING[state].badgeVariant}
    >
        {state}
    </Badge>
)

export const PermissionsSyncJobSubject: React.FunctionComponent<{ job: PermissionsSyncJob }> = ({ job }) => {
    const [isOpen, setIsOpen] = useState<boolean>(false)
    const handleOpenChange = useCallback((event: PopoverOpenEvent): void => {
        setIsOpen(event.isOpen)
    }, [])

    return (
        <div className={classNames({ [styles.visibleActionsOnHover]: !isOpen })}>
            <div className="d-flex align-items-center">
                {job.subject.__typename === 'Repository' ? (
                    <>
                        <ExternalRepositoryIcon externalRepo={job.subject.externalRepository} />
                        <Link to={job.subject.url} className="text-truncate">
                            {job.subject.name}
                        </Link>
                        <Popover isOpen={isOpen} onOpenChange={handleOpenChange}>
                            <PopoverTrigger
                                as={Button}
                                className={classNames('border-0 p-0', styles.actionsButton)}
                                variant="secondary"
                                outline={true}
                            >
                                <Icon aria-label="Show details" svgPath={mdiChevronDown} />
                            </PopoverTrigger>
                            <PopoverContent position={Position.bottom} focusLocked={false}>
                                <div className="p-2">
                                    <Text className="mb-0" weight="bold">
                                        Name
                                    </Text>
                                    <Text className="mb-0">{job.subject.name}</Text>
                                    <Text className="mb-0 mt-2" weight="bold">
                                        External Service
                                    </Text>
                                    <div className="d-flex align-items-center">
                                        <ExternalRepositoryIcon externalRepo={job.subject.externalRepository} />
                                        <Text className="mb-0">{job.subject.externalRepository.serviceType}</Text>
                                    </div>
                                    <Text className="mb-0">{job.subject.externalRepository.serviceID}</Text>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </>
                ) : (
                    <>
                        <Icon className="mr-2" aria-hidden={true} svgPath={mdiAccount} />
                        <Link to={`/users/${job.subject.username}`} className="text-truncate">
                            {job.subject.username}
                        </Link>
                        {(job.subject.email || job.subject.displayName) && (
                            <Popover isOpen={isOpen} onOpenChange={handleOpenChange}>
                                <PopoverTrigger
                                    as={Button}
                                    className={classNames('border-0 p-0', styles.actionsButton)}
                                    variant="secondary"
                                    outline={true}
                                >
                                    <Icon aria-label="Show details" svgPath={mdiChevronDown} />
                                </PopoverTrigger>
                                <PopoverContent position={Position.bottom} focusLocked={false}>
                                    <div className="p-2">
                                        <Text className="mb-0" weight="bold">
                                            {job.subject.displayName}
                                        </Text>
                                        <Text className="mb-0">{job.subject.email}</Text>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        )}
                    </>
                )}
            </div>
            {JOB_STATE_METADATA_MAPPING[job.state].timeGetter(job) !== '' && (
                <Text className="mb-0 text-muted text-truncate">
                    <small>
                        {JOB_STATE_METADATA_MAPPING[job.state].temporalWording}{' '}
                        <Timestamp date={JOB_STATE_METADATA_MAPPING[job.state].timeGetter(job)} />
                    </small>
                </Text>
            )}
        </div>
    )
}

export const PermissionsSyncJobReasonByline: React.FunctionComponent<{ job: PermissionsSyncJob }> = ({ job }) => {
    const message =
        job.reason.group === PermissionsSyncJobReasonGroup.MANUAL && job.triggeredByUser?.username
            ? `by ${job.triggeredByUser.username}`
            : JOB_REASON_TO_READABLE_REASON[job.reason.reason]

    return (
        <Tooltip content={message}>
            <div>
                <Text className="mb-0" weight="medium">
                    {job.reason.group}
                </Text>
                <Text className="mb-0 text-muted text-truncate">
                    <small>{message}</small>
                </Text>
            </div>
        </Tooltip>
    )
}

export const PermissionsSyncJobNumbers: React.FunctionComponent<{ job: PermissionsSyncJob; added: boolean }> = ({
    job,
    added,
}) =>
    added ? (
        <div className="text-success text-right mr-2">
            +<b>{job.permissionsAdded}</b>
        </div>
    ) : (
        <div className="text-danger text-right mr-2">
            -<b>{job.permissionsRemoved}</b>
        </div>
    )
