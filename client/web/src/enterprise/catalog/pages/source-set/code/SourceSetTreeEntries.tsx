import classNames from 'classnames'
import { sortBy } from 'lodash'
import React, { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { propertyIsDefined } from '@sourcegraph/codeintellify/src/helpers'
import { gql } from '@sourcegraph/http-client'
import { FileDecorationsByPath } from '@sourcegraph/shared/src/api/extension/extensionHostApi'
import { ExtensionsControllerProps } from '@sourcegraph/shared/src/extensions/controller'
import { ThemeProps } from '@sourcegraph/shared/src/theme'
import { useObservable } from '@sourcegraph/wildcard'

import { getFileDecorations } from '../../../../../backend/features'
import { SourceSetFilesFields, SourceSetGitTreeFilesFields } from '../../../../../graphql-operations'
import { TreeEntriesSection } from '../../../../../repo/tree/TreeEntriesSection'
import { dirname, pathRelative } from '../../../../../util/path'

import { ComponentSourceLocations } from './ComponentSourceLocations'

export const SOURCE_SET_FILES_FRAGMENT = gql`
    fragment SourceSetFilesFields on SourceSet {
        __typename
        ... on GitTree {
            repository {
                id
                name
                url
            }
            path
            ...SourceSetGitTreeFilesFields
        }
        ... on GitBlob {
            repository {
                id
                name
                url
            }
            path
            commit {
                oid
            }
        }
        ... on Component {
            sourceLocations {
                isPrimary
                repositoryName
                repository {
                    id
                    name
                    url
                }
                path
                treeEntry {
                    __typename
                    url
                    ... on GitBlob {
                        commit {
                            oid
                        }
                        path
                        name
                        isDirectory
                    }
                    ... on GitTree {
                        ...SourceSetGitTreeFilesFields
                    }
                }
            }
        }
    }
    fragment SourceSetGitTreeFilesFields on GitTree {
        commit {
            oid
        }
        entries(recursive: true) {
            path
            name
            isDirectory
            url
        }
    }
`

interface Props extends ExtensionsControllerProps, ThemeProps {
    sourceSet: SourceSetFilesFields
    className?: string
}

type SourceLocation = Pick<
    Extract<SourceSetFilesFields, { __typename: 'Component' }>['sourceLocations'][number],
    'repositoryName' | 'repository' | 'path'
> & { treeEntry: Omit<SourceSetGitTreeFilesFields, '__typename'> }

export const SourceSetTreeEntries: React.FunctionComponent<Props> = ({ sourceSet, className, ...props }) => {
    const sourceLocations = useMemo<SourceLocation[]>(
        () =>
            sourceSet.__typename === 'Component'
                ? sourceSet.sourceLocations.filter(propertyIsDefined('treeEntry')).map(sourceLocation =>
                      sourceLocation.treeEntry.__typename === 'GitTree'
                          ? { ...sourceLocation, treeEntry: sourceLocation.treeEntry }
                          : {
                                ...sourceLocation,
                                treeEntry: {
                                    commit: sourceLocation.treeEntry.commit,
                                    entries: [
                                        {
                                            path: sourceLocation.treeEntry.path,
                                            name: sourceLocation.treeEntry.name,
                                            isDirectory: sourceLocation.treeEntry.isDirectory,
                                            url: sourceLocation.treeEntry.url,
                                        },
                                    ],
                                },
                            }
                  )
                : [
                      {
                          repositoryName: sourceSet.repository.name,
                          repository: sourceSet.repository,
                          path: sourceSet.path,
                          treeEntry:
                              sourceSet.__typename === 'GitTree'
                                  ? sourceSet
                                  : { commit: sourceSet.commit, entries: [] },
                      },
                  ],
        [sourceSet]
    )
    return (
        <div className={className}>
            {sourceSet.__typename === 'Component' && sourceSet.sourceLocations.length >= 2 && (
                <ComponentSourceLocations component={sourceSet} />
            )}
            {sourceLocations.map(sourceLocation => (
                <SourceLocationTreeEntries
                    key={`${sourceLocation.repositoryName}:${sourceLocation.path || ''}`}
                    {...props}
                    sourceLocation={sourceLocation}
                    recursive={sourceSet.__typename === 'Component'}
                />
            ))}
        </div>
    )
}

const SourceLocationTreeEntries: React.FunctionComponent<
    {
        sourceLocation: SourceLocation
        recursive: boolean
        className?: string
    } & ExtensionsControllerProps &
        ThemeProps
> = ({ sourceLocation, recursive, className, extensionsController, isLightTheme }) => {
    const entries = useMemo(
        () =>
            recursive
                ? sourceLocation.treeEntry.entries
                : sourceLocation.treeEntry.entries.filter(entry => dirname(entry.path) === sourceLocation.path),
        [recursive, sourceLocation.path, sourceLocation.treeEntry.entries]
    )

    const files = useMemo(() => entries.filter(entry => !entry.isDirectory), [entries])

    const fileDecorationsByPath =
        useObservable<FileDecorationsByPath>(
            useMemo(
                () =>
                    getFileDecorations({
                        files,
                        extensionsController,

                        repoName: sourceLocation.repositoryName,
                        commitID: sourceLocation.treeEntry.commit.oid,

                        // TODO(sqs): HACK this is used for caching, this value is hacky and probably incorrect
                        parentNodeUri: `${sourceLocation.repositoryName}:${sourceLocation.treeEntry.commit.oid}:${
                            sourceLocation.path ?? ''
                        }`,
                    }),
                [
                    extensionsController,
                    sourceLocation.path,
                    sourceLocation.repositoryName,
                    sourceLocation.treeEntry.commit.oid,
                    files,
                ]
            )
        ) ?? {}

    const rootPath = sourceLocation.path || ''
    const directories = useMemo(
        () =>
            recursive
                ? groupByParentDirectories(rootPath, entries)
                : [
                      {
                          path: rootPath,
                          relativePath: '',
                          url: '',
                          files: entries,
                      },
                  ],
        [recursive, rootPath, entries]
    )

    return (
        <ul className={classNames('list-group list-group-flush', className)}>
            {directories.map(({ path, relativePath, url, files }) =>
                files.length > 0 ? (
                    <li key={path} className="list-group-item small border-0">
                        {path !== rootPath && (
                            <Link to={url} className="text-muted">
                                {relativePath}/
                            </Link>
                        )}
                        <div className={path !== rootPath ? 'ml-3' : undefined}>
                            <TreeEntriesSection
                                parentPath={path}
                                entries={files}
                                fileDecorationsByPath={fileDecorationsByPath}
                                isLightTheme={isLightTheme}
                            />
                        </div>
                    </li>
                ) : null
            )}
        </ul>
    )
}

interface DirectoryWithChildFiles<F> {
    path: string
    relativePath: string
    url: string
    files: F[]
}

function groupByParentDirectories<E extends { path: string; url: string; isDirectory: boolean }>(
    rootPath: string,
    entries: E[]
): DirectoryWithChildFiles<E>[] {
    const parentDirectories = new Map<string, DirectoryWithChildFiles<E>>()
    for (const entry of entries) {
        if (entry.isDirectory) {
            const existing = parentDirectories.get(entry.path)
            if (existing) {
                existing.url = entry.url
            } else {
                parentDirectories.set(entry.path, {
                    path: entry.path,
                    relativePath: pathRelative(rootPath, entry.path),
                    url: entry.url,
                    files: [],
                })
            }
        } else {
            const parentDirname = dirname(entry.path)
            let parentDirectory = parentDirectories.get(parentDirname)
            if (!parentDirectory) {
                parentDirectory = {
                    path: parentDirname,
                    relativePath: pathRelative(rootPath, parentDirname),
                    url: '',
                    files: [],
                }
                parentDirectories.set(parentDirname, parentDirectory)
            }
            parentDirectory.files.push(entry)
        }
    }

    return sortBy([...parentDirectories.values()], 'path')
}
