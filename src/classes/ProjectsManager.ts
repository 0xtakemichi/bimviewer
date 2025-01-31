import { IProject, Project } from "./Project";
import { firestoreDb } from "../firebase"; // Asegúrate de tener configurada tu instancia de Firestore
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, arrayUnion } from "firebase/firestore";
import { trackProjectCreation } from "../helpers/analytics"

export class ProjectsManager {
  list: Project[] = [];
  OnProjectCreated = (project: Project) => {
    console.log(`Project created: ${project.name}`)
  };
  OnProjectDeleted = (id: string) => {
    console.log(`Project deleted with ID: ${id}`)
  };

  constructor(ownerUid: string) {
    this.fetchProjects(ownerUid);
  }

  async fetchProjects(userUid: string) {
    const projectsRef = collection(firestoreDb, 'Projects');
  
    // Consultar proyectos donde el usuario es owner o está en la lista de collaborators
    const q = query(
      projectsRef,
      where("owner", "==", userUid)
    );
  
    const collaboratorQuery = query(
      projectsRef,
      where("collaborators", "array-contains", userUid)
    );
  
    // Ejecutar ambas consultas
    const [ownerSnapshot, collaboratorSnapshot] = await Promise.all([
      getDocs(q),
      getDocs(collaboratorQuery)
    ]);
  
    // Combinar resultados sin duplicar
    const allProjects = [...ownerSnapshot.docs, ...collaboratorSnapshot.docs].reduce((acc, doc) => {
      if (!acc.some(project => project.id === doc.id)) {
        acc.push(new Project(doc.data() as IProject, doc.id));
      }
      return acc;
    }, [] as Project[]);
  
    this.list = allProjects;
  }

  async newProject(data: Omit<IProject, 'owner' | 'collaborators' | 'activityLogs' >, owner: string, id?: string) {
    const projectId = id || doc(collection(firestoreDb, "Projects")).id;
    const project = new Project({ ...data, owner, collaborators: [], activityLogs: []}, projectId);
  
    // Guardar en Firestore con el mismo `id`
    await setDoc(doc(firestoreDb, 'Projects', projectId), { ...project });

    trackProjectCreation(projectId);
  
    console.log('New project created with ID:', projectId); // Depuración
    
    this.list.push(project);
    this.OnProjectCreated(project);
    return project;
  }

  async getProject(id: string): Promise<Project | null> {
    try {
      const projectDoc = await getDoc(doc(firestoreDb, 'Projects', id));
      if (!projectDoc.exists()) return null;
      return new Project(projectDoc.data() as IProject, projectDoc.id);
    } catch (error) {
      console.error('Error fetching project:', error);
      return null;
    }
  }

  async deleteProject(id: string): Promise<void> {
    const projectIndex = this.list.findIndex(project => project.id === id);
    if (projectIndex === -1) {
      throw new Error("Proyecto no encontrado");
    }

    // Eliminar de Firestore
    await deleteDoc(doc(firestoreDb, 'Projects', id));

    this.list.splice(projectIndex, 1); // Elimina del array local
    this.OnProjectDeleted(id);
  }

  async updateProject(id: string, updatedData: Partial<Omit<IProject, 'id'>>) {
    const projectRef = doc(firestoreDb, 'Projects', id);
    await updateDoc(projectRef, updatedData); // Actualiza en Firestore
  
    const projectIndex = this.list.findIndex(project => project.id === id);
    if (projectIndex !== -1) {
      this.list[projectIndex] = new Project({ ...this.list[projectIndex], ...updatedData }, id); // Actualiza localmente
    }
  }

  async addCollaborator(projectId: string, collaboratorEmail: string): Promise<void> {
    try {
      // Buscar el UID del colaborador a partir de su correo en la colección Users
      const usersRef = collection(firestoreDb, 'Users');
      const q = query(usersRef, where('email', '==', collaboratorEmail));
      const querySnapshot = await getDocs(q);
    
      if (querySnapshot.empty) {
        throw new Error(`Ningún usuario encontrado con el correo electrónico: ${collaboratorEmail}`);
      }
  
      const collaboratorUID = querySnapshot.docs[0].id; // UID del colaborador
  
      // Obtener el proyecto actual para verificar duplicados y evitar agregar al owner
      const projectRef = doc(firestoreDb, 'Projects', projectId);
      const projectDoc = await getDoc(projectRef);
      if (!projectDoc.exists()) {
        throw new Error('Proyecto no encontrado');
      }
  
      const projectData = projectDoc.data() as IProject;
  
      // Verificar si el colaborador ya está en la lista o es el owner
      if (projectData.owner === collaboratorUID) {
        throw new Error("El propietario no puede ser agregado como colaborador.");
      }
  
      if (projectData.collaborators.includes(collaboratorUID)) {
        throw new Error("Este colaborador ya está agregado.");
      }
  
      // Actualizar el proyecto en Firestore
      await updateDoc(projectRef, {
        collaborators: arrayUnion(collaboratorUID)
      });
  
      // Actualizar en la lista local
      const projectIndex = this.list.findIndex(project => project.id === projectId);
      if (projectIndex !== -1) {
        this.list[projectIndex].collaborators.push(collaboratorUID);
      }
  
      console.log(`Collaborator ${collaboratorUID} added to project ${projectId}`);
    } catch (error) {
      console.error('Error al añadir colaborador:', error);
      throw error;
    }
  }

  async removeCollaborator(projectId: string, collaboratorUID: string): Promise<void> {
    try {
      // Referencia al proyecto en Firestore
      const projectRef = doc(firestoreDb, 'Projects', projectId);
      const projectDoc = await getDoc(projectRef);
  
      if (!projectDoc.exists()) {
        throw new Error('Proyecto no encontrado');
      }
  
      const projectData = projectDoc.data() as IProject;
  
      // Verificar si el colaborador existe en la lista
      if (!projectData.collaborators.includes(collaboratorUID)) {
        throw new Error("Colaborador no encontrado en el proyecto.");
      }
  
      // Actualizar Firestore para remover el colaborador
      await updateDoc(projectRef, {
        collaborators: projectData.collaborators.filter(uid => uid !== collaboratorUID),
      });
  
      // Actualizar lista local
      const projectIndex = this.list.findIndex(project => project.id === projectId);
      if (projectIndex !== -1) {
        this.list[projectIndex].collaborators = this.list[projectIndex].collaborators.filter(
          uid => uid !== collaboratorUID
        );
      }
  
      console.log(`Colaborador ${collaboratorUID} removido del proyecto: ${projectId}`);
    } catch (error) {
      console.error('Error al eliminar colaborador:', error);
      throw error;
    }
  }
  async getCollaboratorNames(uids: string[]): Promise<Record<string, { name: string, lastName: string }>> {
    try {
      const usersRef = collection(firestoreDb, 'Users');
      const userQueries = uids.map(uid => getDoc(doc(usersRef, uid))); // Consultar todos los usuarios en paralelo
      const userSnapshots = await Promise.all(userQueries);
      
      const collaboratorNames = userSnapshots.reduce((acc, userDoc) => {
        if (userDoc.exists()) {
          const userData = userDoc.data();
          acc[userDoc.id] = {
            name: userData.name || 'Desconocido',
            lastName: userData.lastName || ''
          };
        }
        return acc;
      }, {} as Record<string, { name: string, lastName: string }>);
  
      return collaboratorNames;
    } catch (error) {
      console.error('Error fetching collaborator names:', error);
      throw error;
    }
  }
  
}