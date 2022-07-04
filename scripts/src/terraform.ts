import {Type, Transform, plainToClass, ClassConstructor} from 'class-transformer'
import * as Config from './yaml'
import * as YAML from 'yaml'
import {camelCaseToSnakeCase} from './utils'

interface Identifiable {
  id: string
}

class Resource {
  address!: string
  type!: string
  values!: Identifiable

  equals(other: Resource): boolean {
    return this.address === other.address
  }
}

abstract class ManagedResource extends Resource {
  index!: string
  abstract getYAMLResource(): Config.Resource
}
abstract class DataResource extends Resource {
  getDesiredResources(): DesiredResource[] {
    return []
  }
}
class DesiredResource extends Resource {
  constructor(address: string, values: Identifiable) {
    super()
    this.address = address
    this.type = address.split('.')[0]
    this.values = values
  }
}


class NullResource extends Resource {}

class GithubMembership extends ManagedResource {
  override values!: Identifiable & {
    role: 'admin' | 'member'
    username: string
  }
  override getYAMLResource(): Config.Resource {
    return new Config.Resource(
      this.type,
      ['members', this.values.role],
      YAML.parseDocument(this.values.username).contents as YAML.Scalar
    )
  }
}
class GithubRepository extends ManagedResource {
  override values!: Identifiable & {
    name: string
  }
  override getYAMLResource(): Config.Resource {
    const value = plainToClass(Config.Repository, this.values, { excludeExtraneousValues: true})
    return new Config.Resource(
      this.type,
      ['repositories'],
      (YAML.parseDocument(YAML.stringify({[this.values.name]: value})).contents as YAML.YAMLMap).items[0] as YAML.Pair
    )
  }
}
class GithubRepositoryCollaborator extends ManagedResource {
  override values!: Identifiable & {
    username: string
    repository: string
    permission: 'admin' | 'maintain' | 'push' | 'triage' | 'pull'
  }
  override getYAMLResource(): Config.Resource {
    return new Config.Resource(
      this.type,
      ['repositories',  this.values.repository, 'collaborators', this.values.permission],
      YAML.parseDocument(this.values.username).contents as YAML.Scalar
    )
  }
}
class GithubRepositoryFile extends ManagedResource {
  override values!: Identifiable & {
    branch: string
    file: string
    repository: string
  }
  override getYAMLResource(): Config.Resource {
    const value = plainToClass(Config.File, this.values, { excludeExtraneousValues: true})
    return new Config.Resource(
      this.type,
      ['repositories', this.values.repository, 'files'],
      (YAML.parseDocument(YAML.stringify({[this.values.file]: value})).contents as YAML.YAMLMap).items[0] as YAML.Pair
    )
  }
}
class GithubBranchProtection extends ManagedResource {
  override values!: Identifiable & {
    repository: string
    pattern: string
  }
  override getYAMLResource(): Config.Resource {
    const value = plainToClass(Config.BranchProtection, this.values, { excludeExtraneousValues: true})
    return new Config.Resource(
      this.type,
      ['repositories', this.index.split(':')[0], 'branch_protection'],
      (YAML.parseDocument(YAML.stringify({[this.values.pattern]: value})).contents as YAML.YAMLMap).items[0] as YAML.Pair
    )
  }
}
class GithubTeam extends ManagedResource {
  override values!: Identifiable & {
    name: string
  }
  override getYAMLResource(): Config.Resource {
    const value = plainToClass(Config.Team, this.values, { excludeExtraneousValues: true})
    return new Config.Resource(
      this.type,
      ['teams'],
      (YAML.parseDocument(YAML.stringify({[this.values.name]: value})).contents as YAML.YAMLMap).items[0] as YAML.Pair
    )
  }
}
class GithubTeamMembership extends ManagedResource {
  override values!: Identifiable & {
    username: string
    role: 'maintainer' | 'member'
  }
  override getYAMLResource(): Config.Resource {
    return new Config.Resource(
      this.type,
      ['teams', this.index.split(':')[0], 'members', this.values.role],
      YAML.parseDocument(this.values.username).contents as YAML.Scalar
    )
  }
}
class GithubTeamRepository extends ManagedResource {
  override values!: Identifiable & {
    repository: string
    permission: 'admin' | 'maintain' | 'push' | 'triage' | 'pull'
  }
  override getYAMLResource(): Config.Resource {
    return new Config.Resource(
      this.type,
      ['repositories', this.index.split(':')[1], 'teams', this.values.permission],
      YAML.parseDocument(this.values.repository).contents as YAML.Scalar
    )
  }
}
class GithubOrganizationData extends DataResource {
  override values!: Identifiable & {
    login: string,
    members: string[],
  }
  override getDesiredResources(): DesiredResource[] {
    return this.values.members.map(member => {
      const resource = new DesiredResource(
        `github_membership.this["${member}"]`,
        { id: `${this.values.login}:${member}` }
      )
      return resource;
    })
  }
}
class GithubRepositoriesData extends DataResource {
  override values!: Identifiable & {
    names: string[]
  }

  override getDesiredResources(): DesiredResource[] {
    return this.values.names.map(name => {
      const resource = new DesiredResource(
        `github_repository.this["${name}"]`,
        {id: name}
      )
      return resource
    })
  }
}
class GithubCollaboratorsData extends DataResource {
  override values!: Identifiable & {
    collaborator: {
      login: string
    }[],
    repository: string
  }
  override getDesiredResources(): DesiredResource[] {
    return this.values.collaborator.map(collaborator => {
      const resource = new DesiredResource(
        `github_repository_collaborator.this["${this.values.repository}:${collaborator.login}"]`,
        {id: `${this.values.repository}:${collaborator.login}`}
      )
      return resource
    })
  }
}
class GithubRepositoryData extends DataResource {
  override values!: Identifiable & {
    name: string
    branches: {
      name: string
      protected: boolean
    }[]
    default_branch: string
  }
  override getDesiredResources(): DesiredResource[] {
    return this.values.branches
      .filter(branch => branch.protected)
      .map(branch => {
        const resource = new DesiredResource(
          `github_branch_protection.this["${this.values.name}:${branch.name}"]`,
          { id: `${this.values.name}:${branch.name}` }
        )
        return resource
      })
  }
}
class GithubOrganizationTeamsData extends DataResource {
  override values!: Identifiable & {
    teams: {
      id: string
      name: string
      repositories: string[]
      members: string[]
    }[]
  }
  override getDesiredResources(): DesiredResource[] {
    const resources = []
    resources.push(
      ...this.values.teams.map(team => {
        const resource = new DesiredResource(
          `github_team.this["${team.name}"]`,
          {id: team.id}
        )
        return resource
      })
    )
    resources.push(
      ...this.values.teams.flatMap(team => {
        return team.repositories.map(repository => {
          const resource = new DesiredResource(
            `github_team_repository.this["${team.name}:${repository}"]`,
            {id: `${team.id}:${repository}`}
          )
          return resource
        })
      })
    )
    resources.push(
      ...this.values.teams.flatMap(team => {
        return team.members.map(member => {
          const resource = new DesiredResource(
            `github_team_membership.this["${team.name}:${member}"]`,
            {id: `${team.id}:${member}`}
          )
          return resource
        })
      })
    )
    return resources
  }
}
class GithubBranchData extends DataResource {}
class GithubTreeData extends DataResource {
  index!: string
  override values!: Identifiable & {
    entries: {
      path: string
    }[]
  }
}

export const ManagedResources = [
  GithubMembership,
  GithubRepository,
  GithubRepositoryCollaborator,
  GithubRepositoryFile,
  GithubBranchProtection,
  GithubTeam,
  GithubTeamMembership,
  GithubTeamRepository,
]

export const DataResources = [
  GithubOrganizationData,
  GithubRepositoriesData,
  GithubCollaboratorsData,
  GithubRepositoryData,
  GithubOrganizationTeamsData,
  GithubBranchData,
  GithubTreeData,
]

class Module {
  @Transform(({ value, options }) => {
    return (value as any[]).map(v => {
      if (v.type == 'null_resource') {
        return plainToClass(NullResource, v, options);
      } else if (v.mode === 'managed') {
        const cls = ManagedResources.find(cls => camelCaseToSnakeCase(cls.name) === v.type)
        if (cls !== undefined) {
          return plainToClass(cls as ClassConstructor<ManagedResource>, v, options)
        } else {
          throw new Error(`Expected to find a matching class for: ${JSON.stringify(v)}`)
        }
      } else if (v.mode === 'data') {
        const cls = DataResources.find(cls => camelCaseToSnakeCase(cls.name) === `${v.address.split('.')[1]}_data`)
        if (cls !== undefined) {
          return plainToClass(cls as ClassConstructor<DataResource>, v, options)
        } else {
          throw new Error(`Expected to find a matching class for: ${JSON.stringify(v)}`)
        }
      } else {
        throw new Error(`Expected either a null_resource, ManagedResource or a DataResource, got this instead: ${JSON.stringify(v)}`)
      }
    })
  })
  resources!: Resource[]
}

class Values {
  @Type(() => Module)
  root_module!: Module
}

class State {
  @Type(() => Values)
  values!: Values

  getYAMLResources(): Config.Resource[] {
    return this.getManagedResources().map(resource => resource.getYAMLResource())
  }

  getDataResources(): DataResource[] {
    return this.values.root_module.resources.filter(
      resource => resource instanceof DataResource
    ) as DataResource[]
  }

  getManagedResources(): ManagedResource[] {
    return this.values.root_module.resources.filter(
      resource => resource instanceof ManagedResource
    ) as ManagedResource[]
  }

  getDesiredResources(): DesiredResource[] {
    return this.getDataResources().flatMap(resource =>
      resource.getDesiredResources()
    )
  }

  getResourcesToImport(): Resource[] {
    const managedResources = this.getManagedResources()
    const desiredResources = this.getDesiredResources()

    const resourcesToImport = desiredResources.filter(desiredResource => {
      return !managedResources.find(managedResource =>
        managedResource.equals(desiredResource)
      )
    })

    return resourcesToImport
  }

  getResourcesToRemove(): Resource[] {
    const managedResources = this.getManagedResources()
    const desiredResources = this.getDesiredResources()

    const resourcesToRemove = managedResources.filter(managedResource => {
      if (managedResource instanceof GithubRepositoryFile) {
        return !(
          this.values.root_module.resources.filter(
            resource => resource instanceof GithubTreeData
          ) as GithubTreeData[]
        ).find(
          resource =>
            resource.index ===
              `${managedResource.values.repository}:${managedResource.values.branch}` &&
            resource.values.entries.find(
              entry => entry.path === managedResource.values.file
            )
        )
      } else {
        return !desiredResources.find(desiredResource =>
          desiredResource.equals(managedResource)
        )
      }
    })

    return resourcesToRemove
  }
}
export function parse(json: string): State {
  return plainToClass(State, JSON.parse(json))
}
