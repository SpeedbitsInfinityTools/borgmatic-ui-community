import { useQuery, useMutation, useQueryClient } from 'react-query';
import { repositoriesAPI, sshKeysAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import { MountTestResult } from '../types/repositories';

/**
 * Hook for fetching repositories
 */
export const useRepositories = () => {
  const { data: repositoriesData, isLoading } = useQuery({
    queryKey: ['config-parser-repositories'],
    // Use repositories fast list (stable IDs, same data used by Templates dropdown)
    queryFn: () => repositoriesAPI.getRepositoriesFast().then(res => res.data),
  });

  const repositories = repositoriesData?.data?.repositories || [];
  return { repositories, isLoading };
};

/**
 * Hook for fetching SSH keys
 */
export const useSSHKeys = () => {
  return useQuery({
    queryKey: ['ssh-keys'],
    queryFn: sshKeysAPI.getSSHKeys,
  });
};

/**
 * Hook for repository mutations
 */
export const useRepositoryMutations = (options?: {
  onCreateSuccess?: () => void;
  onUpdateSuccess?: () => void;
  onMountTestSuccess?: (result: MountTestResult) => void;
  onMountTestError?: (error: string) => void;
}) => {
  const queryClient = useQueryClient();

  const createRepositoryMutation = useMutation({
    mutationFn: repositoriesAPI.createRepository,
    onSuccess: async (response, variables) => {
      // For Direct mode Rclone, create persistent mount
      if (variables.repository_type === 'rclone' && variables.storage_mode === 'direct' && variables.mount_path) {
        try {
          const repoId = response.data?.data?.id || response.data?.id;
          await repositoriesAPI.createPersistentMount({
            rclone_remote: variables.rclone_remote || '',
            rclone_path: variables.rclone_path,
            mount_path: variables.mount_path,
            repository_id: repoId || variables.name,
          });
          toast.success('Repository created and persistent mount configured');
        } catch (mountError: any) {
          console.error('Failed to create persistent mount:', mountError);
          toast.error(`Repository created but mount setup failed: ${mountError.response?.data?.detail || mountError.message}`);
        }
      } else {
        toast.success('Repository created successfully');
      }
      queryClient.invalidateQueries({ queryKey: ['config-parser-repositories'] });
      queryClient.invalidateQueries({ queryKey: ['config-parser-state'] });
      options?.onCreateSuccess?.();
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.detail || 'Failed to create repository';
      toast.error(errorMsg);
      // Error will be displayed in the modal via the error state
    },
  });

  const updateRepositoryMutation = useMutation({
    mutationFn: ({ path, ...data }: { path: string; [key: string]: any }) =>
      repositoriesAPI.updateRepositoryByPath(path, data),
    onSuccess: () => {
      toast.success('Repository updated successfully');
      queryClient.invalidateQueries({ queryKey: ['config-parser-repositories'] });
      queryClient.invalidateQueries({ queryKey: ['config-parser-state'] });
      options?.onUpdateSuccess?.();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to update repository');
    },
  });

  const deleteRepositoryMutation = useMutation({
    mutationFn: ({ path, deleteOnDisk }: { path: string; deleteOnDisk: boolean }) =>
      repositoriesAPI.deleteRepositoryByPath(path, deleteOnDisk),
    onSuccess: (response) => {
      toast.success(response.data?.message || 'Repository deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['config-parser-repositories'] });
      queryClient.invalidateQueries({ queryKey: ['config-parser-state'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to delete repository');
    },
  });

  const checkRepositoryMutation = useMutation({
    mutationFn: repositoriesAPI.checkRepository,
    onSuccess: () => {
      toast.success('Repository check completed');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to check repository');
    },
  });

  const compactRepositoryMutation = useMutation({
    mutationFn: repositoriesAPI.compactRepository,
    onSuccess: () => {
      toast.success('Repository compaction completed');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to compact repository');
    },
  });

  const tryMountMutation = useMutation({
    mutationFn: (data: { rclone_remote: string; rclone_path?: string; mount_path: string }) => {
      console.log('📡 Calling tryMount API with:', data);
      return repositoriesAPI.tryMount(data);
    },
    onSuccess: (response) => {
      console.log('✅ Try mount success:', response);
      const message = response.data?.message || response.data?.detail || 'Mount test successful';
      const result: MountTestResult = { status: 'success', message };
      options?.onMountTestSuccess?.(result);
      toast.success(message);
    },
    onError: (error: any) => {
      console.error('❌ Try mount error:', error);
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || error.message || 'Mount test failed';
      const result: MountTestResult = { status: 'error', message: errorMsg };
      options?.onMountTestError?.(errorMsg);
      options?.onMountTestSuccess?.(result);
      toast.error(errorMsg);
    },
  });

  return {
    createRepositoryMutation,
    updateRepositoryMutation,
    deleteRepositoryMutation,
    checkRepositoryMutation,
    compactRepositoryMutation,
    tryMountMutation,
  };
};

