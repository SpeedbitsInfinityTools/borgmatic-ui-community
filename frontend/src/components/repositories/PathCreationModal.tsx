import React from 'react';

interface PathCreationModalProps {
  path: string;
  onCreate: () => void;
  onCancel: () => void;
}

const PathCreationModal: React.FC<PathCreationModalProps> = ({
  path,
  onCreate,
  onCancel,
}) => {
  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Path Does Not Exist</h3>
          <p className="text-sm text-gray-600 mb-4">
            The path <code className="bg-gray-100 px-1 rounded">{path}</code> does not exist.
            Do you want to create it?
          </p>
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              No
            </button>
            <button
              type="button"
              onClick={onCreate}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              Yes, Create Path
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PathCreationModal;

