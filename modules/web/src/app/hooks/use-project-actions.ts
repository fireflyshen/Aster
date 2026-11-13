import {
  focusProject,
  inProject,
  projectStatus,
  type ProjectStatus,
} from "@core/workspace/focus";
import type {
  Organization,
  OrganizationChange,
} from "@core/workspace/organization";
import { useCallback, useEffect, useState } from "react";

type ProjectActionsDeps = {
  currentProject: string;
  organization: Organization;
  setOrganizationError: (error: string) => void;
  setNavOpen: (open: boolean) => void;
  changeOrganization: (change: OrganizationChange) => Promise<boolean>;
};

/** Encapsulates project creation, editing, focus transition, deletion, and header meta editing. */
export function useProjectActions({
  currentProject,
  organization,
  setOrganizationError,
  setNavOpen,
  changeOrganization,
}: ProjectActionsDeps) {
  const [focusPickerOpen, setFocusPickerOpen] = useState(false);
  const [transitionProject, setTransitionProject] = useState<{
    name: string;
    status: ProjectStatus;
  }>();
  const [editingProject, setEditingProject] = useState<string>();
  const [newProjectParent, setNewProjectParent] = useState("");
  const [editingHeaderOutcome, setEditingHeaderOutcome] = useState(false);
  const [headerOutcomeDraft, setHeaderOutcomeDraft] = useState("");
  const [editingHeaderDesc, setEditingHeaderDesc] = useState(false);
  const [headerDescDraft, setHeaderDescDraft] = useState("");
  const [deletingProject, setDeletingProject] = useState<{
    name: string;
    revision: number;
  }>();

  useEffect(() => {
    setEditingHeaderOutcome(false);
    setEditingHeaderDesc(false);
  }, [currentProject]);

  const editProject = useCallback(
    (name: string) => {
      setOrganizationError("");
      setNewProjectParent("");
      setEditingProject(name);
      if (innerWidth < 768) setNavOpen(false);
    },
    [setOrganizationError, setNavOpen],
  );

  const addSubproject = useCallback(
    (parent: string) => {
      editProject("");
      setNewProjectParent(parent);
    },
    [editProject],
  );

  const transition = useCallback(
    (name: string, status: ProjectStatus) => {
      setOrganizationError("");
      if (innerWidth < 768) setNavOpen(false);
      if (status === "later") {
        void changeOrganization({
          revision: organization.revision,
          kind: "project",
          action: "status",
          name,
          status: "later",
        });
        return;
      }
      if (status === "active") {
        const record = organization.projects?.find(
          (item) => item.name === name,
        );
        const active = (organization.projects || []).filter(
          (item) => item.name !== name && projectStatus(item) === "active",
        );
        const overlaps = active.filter(
          (item) => inProject(item.name, name) || inProject(name, item.name),
        );
        if (record?.outcome?.trim() && active.length < 3 && !overlaps.length) {
          void changeOrganization({
            revision: organization.revision,
            kind: "project",
            action: "status",
            name,
            status: "active",
            outcome: record.outcome.trim(),
          });
          setFocusPickerOpen(false);
          return;
        }
      }
      setTransitionProject({ name, status });
    },
    [
      setOrganizationError,
      setNavOpen,
      changeOrganization,
      organization.revision,
      organization.projects,
    ],
  );

  const deleteProject = useCallback(
    (name: string) => {
      setOrganizationError("");
      setDeletingProject({ name, revision: organization.revision });
      if (innerWidth < 768) setNavOpen(false);
    },
    [setOrganizationError, organization.revision, setNavOpen],
  );

  const currentProjectRecord = organization.projects?.find(
    (item) => item.name === currentProject,
  );
  const currentProjectFocus = currentProject
    ? focusProject(currentProject, organization.projects)
    : undefined;

  return {
    focusPickerOpen,
    setFocusPickerOpen,
    transitionProject,
    setTransitionProject,
    editingProject,
    setEditingProject,
    newProjectParent,
    editingHeaderOutcome,
    setEditingHeaderOutcome,
    headerOutcomeDraft,
    setHeaderOutcomeDraft,
    editingHeaderDesc,
    setEditingHeaderDesc,
    headerDescDraft,
    setHeaderDescDraft,
    deletingProject,
    setDeletingProject,
    currentProjectRecord,
    currentProjectFocus,
    editProject,
    addSubproject,
    transition,
    deleteProject,
  };
}
