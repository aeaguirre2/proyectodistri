// Variables globales
let stompClient = null;
let currentUser = null;

// Conexión WebSocket
function connectWebSocket() {
    const token = localStorage.getItem('token');
    if (!token) return;

    const socket = new SockJS('/subastas-ws');
    stompClient = Stomp.over(socket);
    
    stompClient.connect({'Authorization': `Bearer ${token}`}, function(frame) {
        console.log('Conectado: ' + frame);
        
        // Suscribirse a notificaciones personales
        const username = JSON.parse(atob(token.split('.')[1])).sub;
        stompClient.subscribe('/user/queue/notifications', function(notification) {
            const data = JSON.parse(notification.body);
            
            switch(data.type) {
                case 'AUCTION_WON':
                    showSuccessToast(data.message);
                    // Actualizar inmediatamente la vista de pujas
                    loadMisPujas();
                    // Reproducir sonido de victoria
                    playNotificationSound('success');
                    break;
                    
                case 'AUCTION_ENDED':
                case 'AUCTION_FAILED':
                    showErrorToast(data.message);
                    // Actualizar la vista de pujas
                    loadMisPujas();
                    // Reproducir sonido de notificación
                    playNotificationSound('notification');
                    break;
            }
        });
        
        subscribeToAuctions();
    }, function(error) {
        console.error('Error de conexión:', error);
        setTimeout(connectWebSocket, 5000); // Reintentar conexión
    });
}

function subscribeToAuctions() {
    stompClient.subscribe('/topic/subastas', function(message) {
        const subasta = JSON.parse(message.body);
        updateAuctionUI(subasta);
    });
}

// Funciones de autenticación
document.getElementById('loginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    // Mostrar indicador de carga
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Iniciando sesión...';

    fetch('/api/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username: formData.get('username'),
            password: formData.get('password')
        })
    })
    .then(response => {
        if (!response.ok) {
            return response.text().then(text => {
                throw new Error(text || 'Error en la autenticación');
            });
        }
        return response.json();
    })
    .then(data => {
        if (!data.token || !data.usuario) {
            throw new Error('Respuesta del servidor inválida');
        }
        
        localStorage.setItem('token', data.token);
        localStorage.setItem('currentUser', JSON.stringify(data.usuario));
        currentUser = data.usuario;
        
        // Cerrar el modal de login
        const loginModal = document.getElementById('loginModal');
        const modal = bootstrap.Modal.getInstance(loginModal);
        modal.hide();
        
        updateUIForUser(currentUser);
        e.target.reset();
        showSuccessToast('Sesión iniciada correctamente');
        connectWebSocket();
    })
    .catch(error => {
        console.error('Error:', error);
        showErrorToast(error.message);
    })
    .finally(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    });
});

// Función para verificar si hay una sesión activa al cargar la página
window.addEventListener('load', function() {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('currentUser');
    
    if (token && savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            updateUIForUser(currentUser);
            connectWebSocket();
        } catch (error) {
            console.error('Error al restaurar la sesión:', error);
            logout();
        }
    }
});

function logout() {
    // Limpiar datos de sesión
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    currentUser = null;
    
    // Ocultar secciones de usuario
    document.getElementById('loginSection').classList.remove('d-none');
    document.getElementById('registerSection').classList.remove('d-none');
    document.getElementById('userSection').classList.add('d-none');
    document.getElementById('controlPanel').classList.add('d-none');
    
    // Ocultar secciones específicas por tipo de usuario
    document.getElementById('misAutosSection').style.display = 'none';
    document.getElementById('misSubastasSection').style.display = 'none';
    document.getElementById('misPujasSection').style.display = 'none';
    
    // Limpiar y ocultar secciones de administrador
    const adminUsersList = document.getElementById('adminUsersList');
    if (adminUsersList) {
        adminUsersList.innerHTML = '';
    }

    // Ocultar sección de subastas finalizadas
    const subastasFinalizadasSection = document.getElementById('subastasFinalizadasSection');
    if (subastasFinalizadasSection) {
        subastasFinalizadasSection.style.display = 'none';
    }
    const subastasFinalizadasList = document.getElementById('subastasFinalizadasList');
    if (subastasFinalizadasList) {
        subastasFinalizadasList.innerHTML = '';
    }
    
    // Desconectar WebSocket
    if (stompClient) {
        stompClient.disconnect();
        stompClient = null;
    }
    
    // Recargar solo las subastas activas
    loadActiveAuctions();
    
    showSuccessToast('Sesión cerrada correctamente');
}

// Funciones de UI
function updateUIForUser(user) {
    const loginSection = document.getElementById('loginSection');
    const registerSection = document.getElementById('registerSection');
    const userSection = document.getElementById('userSection');
    const userInfo = document.getElementById('userInfo');
    const controlPanel = document.getElementById('controlPanel');
    const misAutosSection = document.getElementById('misAutosSection');
    const misSubastasSection = document.getElementById('misSubastasSection');
    const misPujasSection = document.getElementById('misPujasSection');
    const subastasActivasSection = document.getElementById('subastasActivasList');

    // Ocultar secciones de login/registro
    loginSection.classList.add('d-none');
    registerSection.classList.add('d-none');
    userSection.classList.remove('d-none');

    // Mostrar información del usuario
    userInfo.textContent = `${user.nombre} ${user.apellido} (${user.tipoUsuario})`;

    // Ocultar todas las secciones primero
    misAutosSection.style.display = 'none';
    misSubastasSection.style.display = 'none';
    misPujasSection.style.display = 'none';
    controlPanel.classList.add('d-none');

    if (user.tipoUsuario === 'ADMIN') {
        controlPanel.classList.remove('d-none');
        controlPanel.innerHTML = `
            <div class="card">
                <div class="card-header bg-primary text-white">
                    <h3 class="mb-0">
                        <i class="fas fa-tools me-2"></i>Panel de Administrador
                    </h3>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-4 mb-3">
                            <button class="btn btn-primary w-100" onclick="showModal('crearSubastaModal')">
                                <i class="fas fa-plus-circle me-2"></i>Crear Nueva Subasta
                            </button>
                        </div>
                        <div class="col-md-4 mb-3">
                            <button class="btn btn-success w-100" onclick="showModal('registrarAutoModal')">
                                <i class="fas fa-car me-2"></i>Registrar Auto
                            </button>
                        </div>
                        <div class="col-md-4 mb-3">
                            <button class="btn btn-info w-100" onclick="showModal('adminRegisterModal')">
                                <i class="fas fa-user-plus me-2"></i>Registrar Usuario
                            </button>
                        </div>
                    </div>
                    <div id="usersListContainer" class="mt-4">
                        <h4>Gestión de Usuarios</h4>
                        <div class="table-responsive">
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Usuario</th>
                                        <th>Nombre</th>
                                        <th>Tipo</th>
                                        <th>Estado</th>
                                        <th>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody id="adminUsersList"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Agregar el modal de registro de usuarios para admin
        if (!document.getElementById('adminRegisterModal')) {
            const modalHtml = `
                <div class="modal fade" id="adminRegisterModal" tabindex="-1">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Registrar Nuevo Usuario</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <form id="adminRegisterForm">
                                    <div class="mb-3">
                                        <label class="form-label">Nombre de Usuario</label>
                                        <input type="text" class="form-control" name="username" required>
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">Contraseña</label>
                                        <input type="password" class="form-control" name="password" required>
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">Email</label>
                                        <input type="email" class="form-control" name="email" required>
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">Nombre</label>
                                        <input type="text" class="form-control" name="nombre" required>
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">Apellido</label>
                                        <input type="text" class="form-control" name="apellido" required>
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">Tipo de Usuario</label>
                                        <select class="form-select" name="tipoUsuario" required>
                                            <option value="ADMIN">Administrador</option>
                                            <option value="VENDEDOR">Vendedor</option>
                                            <option value="COMPRADOR">Comprador</option>
                                        </select>
                                    </div>
                                    <button type="submit" class="btn btn-primary w-100">
                                        <i class="fas fa-user-plus me-2"></i>Registrar Usuario
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);

            // Agregar el event listener para el formulario de registro de admin
            document.getElementById('adminRegisterForm').addEventListener('submit', function(e) {
                e.preventDefault();
                const formData = new FormData(e.target);
                
                // Validaciones del formulario
                const username = formData.get('username');
                const password = formData.get('password');
                const email = formData.get('email');
                const nombre = formData.get('nombre');
                const apellido = formData.get('apellido');
                const tipoUsuario = formData.get('tipoUsuario');
                
                if (!username || !password || !email || !nombre || !apellido || !tipoUsuario) {
                    showErrorToast('Por favor complete todos los campos');
                    return;
                }
                
                // Validar formato de email
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    showErrorToast('Por favor ingrese un email válido');
                    return;
                }
                
                // Mostrar indicador de carga
                const submitBtn = e.target.querySelector('button[type="submit"]');
                const originalText = submitBtn.innerHTML;
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Registrando...';

                const userData = {
                    username: username.trim(),
                    password: password,
                    email: email.trim(),
                    nombre: nombre.trim(),
                    apellido: apellido.trim(),
                    tipoUsuario: tipoUsuario
                };

                const token = localStorage.getItem('token');
                fetch('/api/auth/registro', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(userData)
                })
                .then(async response => {
                    const text = await response.text();
                    if (!response.ok) {
                        throw new Error(text || 'Error en el registro');
                    }
                    return JSON.parse(text);
                })
                .then(data => {
                    showSuccessToast('Usuario registrado exitosamente');
                    
                    // Cerrar el modal
                    const modal = bootstrap.Modal.getInstance(document.getElementById('adminRegisterModal'));
                    modal.hide();
                    
                    // Limpiar el formulario
                    e.target.reset();
                    
                    // Recargar la lista de usuarios
                    loadUsersList();
                })
                .catch(error => {
                    console.error('Error en el registro:', error);
                    showErrorToast(error.message || 'Error en el registro');
                })
                .finally(() => {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                });
            });
        }

        loadUsersList();
        loadActiveAuctions();
        document.getElementById('subastasFinalizadasSection').style.display = 'block';
        loadSubastasFinalizadas();
    } else if (user.tipoUsuario === 'VENDEDOR') {
        controlPanel.classList.remove('d-none');
        controlPanel.innerHTML = `
            <div class="card">
                <div class="card-header bg-primary text-white">
                    <h3 class="mb-0">
                        <i class="fas fa-tools me-2"></i>Panel de Vendedor
                    </h3>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <button class="btn btn-primary w-100" onclick="showModal('crearSubastaModal')">
                                <i class="fas fa-plus-circle me-2"></i>Crear Nueva Subasta
                            </button>
                        </div>
                        <div class="col-md-6 mb-3">
                            <button class="btn btn-success w-100" onclick="showModal('registrarAutoModal')">
                                <i class="fas fa-car me-2"></i>Registrar Auto
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        misAutosSection.style.display = 'block';
        misSubastasSection.style.display = 'block';
        loadVendedorAutos();
        loadVendedorSubastas();
        loadActiveAuctions();
    } else if (user.tipoUsuario === 'COMPRADOR') {
        misPujasSection.style.display = 'block';
        loadMisPujas();
        loadActiveAuctions();
    }
}

// Función auxiliar para mostrar modales
function showModal(modalId) {
    const modal = new bootstrap.Modal(document.getElementById(modalId));
    modal.show();
}

// Registro de auto
document.getElementById('registrarAutoForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    // Validaciones del formulario
    if (!formData.get('marca') || !formData.get('modelo') || !formData.get('anio') || 
        !formData.get('descripcion') || !formData.get('precioBase')) {
        showErrorToast('Por favor complete todos los campos');
        return;
    }

    const anio = parseInt(formData.get('anio'));
    if (isNaN(anio) || anio < 1900 || anio > new Date().getFullYear() + 1) {
        showErrorToast('Por favor ingrese un año válido');
        return;
    }

    const precioBase = parseFloat(formData.get('precioBase'));
    if (isNaN(precioBase) || precioBase <= 0) {
        showErrorToast('Por favor ingrese un precio base válido');
        return;
    }

    // Mostrar indicador de carga
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Registrando...';

    const token = localStorage.getItem('token');
    if (!token) {
        showErrorToast('No hay sesión activa');
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        return;
    }

    const autoData = {
        marca: formData.get('marca').trim(),
        modelo: formData.get('modelo').trim(),
        anio: anio,
        descripcion: formData.get('descripcion').trim(),
        precioBase: precioBase
    };

    console.log('Enviando datos del auto:', autoData);

    fetch('/api/autos/registrar', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(autoData)
    })
    .then(async response => {
        const contentType = response.headers.get('content-type');
        const text = await response.text();
        console.log('Respuesta del servidor:', text);
        
        if (!response.ok) {
            throw new Error(text || 'Error al registrar el auto');
        }
        
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('Error parseando respuesta:', e);
            throw new Error('Error en el formato de respuesta del servidor');
        }
        
        return data;
    })
    .then(auto => {
        console.log('Auto registrado:', auto);
        showSuccessToast('Auto registrado exitosamente');
        
        // Cerrar el modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('registrarAutoModal'));
        if (modal) {
            modal.hide();
        }
        
        // Limpiar el formulario
        e.target.reset();
        
        // Recargar las listas
        loadVendedorAutos();
    })
    .catch(error => {
        console.error('Error:', error);
        showErrorToast(error.message || 'Error al registrar el auto');
    })
    .finally(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    });
});

// Registro de usuario
document.getElementById('registerForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    // Validaciones del formulario
    const username = formData.get('username');
    const password = formData.get('password');
    const email = formData.get('email');
    const nombre = formData.get('nombre');
    const apellido = formData.get('apellido');
    const tipoUsuario = formData.get('tipoUsuario');
    
    if (!username || !password || !email || !nombre || !apellido || !tipoUsuario) {
        showErrorToast('Por favor complete todos los campos');
        return;
    }
    
    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showErrorToast('Por favor ingrese un email válido');
        return;
    }
    
    // Mostrar indicador de carga
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Registrando...';

    const userData = {
        username: username.trim(),
        password: password,
        email: email.trim(),
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        tipoUsuario: tipoUsuario
    };

    console.log('Enviando datos de registro:', { ...userData, password: '****' });

    fetch('/api/auth/registro', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(userData)
    })
    .then(async response => {
        const contentType = response.headers.get('content-type');
        const text = await response.text();
        console.log('Respuesta del servidor:', text);
        
        if (!response.ok) {
            throw new Error(text || 'Error en el registro');
        }
        
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('Error parseando respuesta:', e);
            throw new Error('Error en el formato de respuesta del servidor');
        }
        
        return data;
    })
    .then(data => {
        showSuccessToast('Usuario registrado exitosamente');
        
        // Cerrar el modal de registro
        const registerModal = bootstrap.Modal.getInstance(document.getElementById('registerModal'));
        if (registerModal) {
            registerModal.hide();
        }
        
        // Limpiar el formulario
        e.target.reset();
    })
    .catch(error => {
        console.error('Error en el registro:', error);
        showErrorToast(error.message || 'Error en el registro');
    })
    .finally(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    });
});

// Funciones de notificación
function showSuccessToast(message) {
    const toast = new bootstrap.Toast(document.getElementById('successToast'));
    document.getElementById('successToastMessage').textContent = message;
    toast.show();
}

function showErrorToast(message) {
    const toast = new bootstrap.Toast(document.getElementById('errorToast'));
    document.getElementById('errorToastMessage').textContent = message;
    toast.show();
}

// Habilitar pujas para compradores
function enableBidding() {
    const pujaButtons = document.querySelectorAll('.puja-btn');
    pujaButtons.forEach(btn => {
        btn.disabled = false;
        btn.addEventListener('click', realizarPuja);
    });
}

// Función para cargar las pujas del comprador
function loadMisPujas() {
    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('/api/pujas/comprador', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => {
        if (!response.ok) {
            return response.text().then(text => {
                throw new Error(text || 'Error al cargar las pujas');
            });
        }
        return response.json();
    })
    .then(pujas => {
        const pujasList = document.getElementById('misPujasList');
        if (!pujasList) return;

        pujasList.innerHTML = '';
        if (pujas && pujas.length > 0) {
            pujas.forEach(puja => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${puja.tituloSubasta}</td>
                    <td>${puja.informacionAuto}</td>
                    <td>$${puja.monto ? puja.monto.toFixed(2) : '0.00'}</td>
                    <td>${puja.fecha ? new Date(puja.fecha).toLocaleString() : 'N/A'}</td>
                    <td>
                        ${puja.subastaFinalizada ? 
                            (puja.ganadora ? 
                                '<span class="badge bg-success">¡Ganador!</span>' : 
                                '<span class="badge bg-danger">No ganador</span>'
                            ) : 
                            '<span class="badge bg-warning">En proceso</span>'
                        }
                    </td>
                `;
                
                // Agregar clase especial si es ganador
                if (puja.ganadora) {
                    row.classList.add('table-success');
                }
                
                pujasList.appendChild(row);
            });
        } else {
            pujasList.innerHTML = '<tr><td colspan="5" class="text-center">No has realizado ninguna puja</td></tr>';
        }
    })
    .catch(error => {
        console.error('Error cargando pujas:', error);
        showErrorToast(error.message || 'Error al cargar las pujas');
    });
}

// Actualizar la función realizarPuja para recargar la lista de pujas después de una puja exitosa
async function realizarPuja(event, subastaId, autoId, precioActual) {
    event.preventDefault();
    const form = event.target;
    const monto = parseFloat(form.montoPuja.value);

    if (monto <= precioActual) {
        showErrorToast('El monto debe ser mayor al precio actual');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/subastas/${subastaId}/autos/${autoId}/pujar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(monto)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }

        showSuccessToast('Puja realizada exitosamente');
        loadActiveAuctions();
        loadMisPujas();
    } catch (error) {
        showErrorToast(error.message);
    }
}

// Funciones de subastas
function loadActiveAuctions() {
    const token = localStorage.getItem('token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    fetch('/api/subastas/activas', {
        headers: headers
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Error al cargar las subastas activas');
        }
        return response.json();
    })
    .then(subastas => {
        const subastasList = document.getElementById('subastasActivasList');
        if (!subastasList) return;

        subastasList.innerHTML = '';
        if (subastas && subastas.length > 0) {
            subastas.forEach(subasta => {
                const card = createAuctionCard(subasta);
                subastasList.appendChild(card);
            });
        } else {
            subastasList.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-info text-center">
                        <i class="fas fa-info-circle me-2"></i>No hay subastas activas en este momento
                    </div>
                </div>
            `;
        }
    })
    .catch(error => {
        console.error('Error cargando subastas activas:', error);
        const subastasList = document.getElementById('subastasActivasList');
        if (subastasList) {
            subastasList.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-danger text-center">
                        <i class="fas fa-exclamation-circle me-2"></i>${error.message}
                    </div>
                </div>
            `;
        }
    });
}

// Cargar subastas activas al iniciar la página
window.addEventListener('DOMContentLoaded', function() {
    loadActiveAuctions();
});

function createAuctionCard(subasta) {
    const card = document.createElement('div');
    card.className = 'col-md-6 mb-4';
    
    // Determinar el estado de la subasta
    let estado = 'Activa';
    let estadoClass = 'success';
    if (subasta.finalizada) {
        estado = 'Finalizada';
        estadoClass = 'secondary';
    } else if (subasta.cancelada) {
        estado = 'Cancelada';
        estadoClass = 'danger';
    }

    // Calcular tiempo restante
    let tiempoRestanteHtml = '';
    if (!subasta.finalizada && !subasta.cancelada) {
        const fechaFin = new Date(subasta.fechaFin);
        const ahora = new Date();
        const diferencia = fechaFin - ahora;
        
        if (diferencia > 0) {
            const horas = Math.floor(diferencia / (1000 * 60 * 60));
            const minutos = Math.floor((diferencia % (1000 * 60 * 60)) / (1000 * 60));
            tiempoRestanteHtml = `
                <div class="alert alert-info">
                    <i class="fas fa-clock me-2"></i>Tiempo restante: ${horas} horas, ${minutos} minutos
                </div>
            `;
        }
    }
    
    // Preparar la información de los autos
    let autosHtml = '';
    if (subasta.autos && subasta.autos.length > 0) {
        autosHtml = subasta.autos.map(autoSubasta => {
            const auto = autoSubasta.auto;
            if (!auto) return '';

            const precioBase = auto.precioBase ? parseFloat(auto.precioBase) : 0;
            const precioActual = autoSubasta.precioFinal ? parseFloat(autoSubasta.precioFinal) : precioBase;
            
            // Formulario de puja solo para compradores y subastas activas
            let pujaHtml = '';
            if (currentUser && 
                currentUser.tipoUsuario === 'COMPRADOR' && 
                !subasta.finalizada && 
                !subasta.cancelada) {
                pujaHtml = `
                    <div class="card mt-3">
                        <div class="card-body">
                            <h6 class="card-title">Realizar Puja</h6>
                            <form class="puja-form" onsubmit="realizarPuja(event, ${subasta.id}, ${auto.id}, ${precioActual})">
                                <div class="input-group mb-2">
                                    <span class="input-group-text">$</span>
                                    <input type="number" 
                                           class="form-control" 
                                           name="montoPuja" 
                                           min="${precioActual + 1}" 
                                           step="0.01" 
                                           required
                                           placeholder="Ingrese monto mayor a $${precioActual}">
                                </div>
                                <button type="submit" class="btn btn-success btn-sm w-100">
                                    <i class="fas fa-gavel me-2"></i>Realizar Puja
                                </button>
                            </form>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="card mb-3">
                    <div class="card-header bg-primary text-white">
                        <h6 class="mb-0">
                            <i class="fas fa-car me-2"></i>${auto.marca} ${auto.modelo} (${auto.anio})
                        </h6>
                    </div>
                    <div class="card-body">
                        <p class="card-text">${auto.descripcion}</p>
                        <div class="row">
                            <div class="col-6">
                                <div class="price-box border rounded p-2 text-center">
                                    <small class="text-muted d-block">Precio Base</small>
                                    <strong class="text-primary">$${precioBase.toFixed(2)}</strong>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="price-box border rounded p-2 text-center">
                                    <small class="text-muted d-block">Precio Actual</small>
                                    <strong class="text-success">$${precioActual.toFixed(2)}</strong>
                                </div>
                            </div>
                        </div>
                        ${pujaHtml}
                    </div>
                </div>
            `;
        }).join('');
    } else {
        autosHtml = '<div class="alert alert-warning">No hay vehículos en esta subasta</div>';
    }

    card.innerHTML = `
        <div class="card h-100">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h5 class="mb-0">
                    <i class="fas fa-gavel me-2"></i>${subasta.titulo || 'Subasta sin título'}
                </h5>
                <span class="badge bg-${estadoClass}">${estado}</span>
            </div>
            <div class="card-body">
                <p class="card-text">${subasta.descripcion || 'Sin descripción'}</p>
                <div class="mb-3">
                    <small class="text-muted">
                        <i class="fas fa-calendar me-2"></i>Inicio: ${new Date(subasta.fechaInicio).toLocaleString()}
                    </small><br>
                    <small class="text-muted">
                        <i class="fas fa-calendar-check me-2"></i>Fin: ${new Date(subasta.fechaFin).toLocaleString()}
                    </small>
                </div>
                ${tiempoRestanteHtml}
                <div class="autos-section">
                    <h6 class="border-bottom pb-2 mb-3">Vehículos en Subasta</h6>
                    ${autosHtml}
                </div>
            </div>
        </div>
    `;

    return card;
}

function updateAuctionUI(subasta) {
    const auctionCard = document.querySelector(`#subastasList .col-md-6:nth-child(${subasta.id % 2 === 0 ? 'even' : 'odd'})`);
    if (auctionCard) {
        const pujaBtn = auctionCard.querySelector('.puja-btn');
        if (pujaBtn) {
            pujaBtn.disabled = false;
            pujaBtn.addEventListener('click', () => realizarPuja({ target: pujaBtn, dataset: { subastaId: subasta.id, autoId: subasta.auto.id } }));
        }
    }
}

// Manejo de formularios de subastas y autos
document.getElementById('crearSubastaForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    // Validaciones
    if (!formData.get('titulo') || !formData.get('descripcion') || 
        !formData.get('fechaInicio') || !formData.get('fechaFin')) {
        showErrorToast('Por favor complete todos los campos');
        return;
    }

    const fechaInicio = new Date(formData.get('fechaInicio'));
    const fechaFin = new Date(formData.get('fechaFin'));
    
    if (fechaFin <= fechaInicio) {
        showErrorToast('La fecha de fin debe ser posterior a la fecha de inicio');
        return;
    }

    // Obtener los autos seleccionados
    const autosSeleccionados = Array.from(document.querySelectorAll('.auto-select'))
        .map(select => select.value)
        .filter(value => value !== "");

    if (autosSeleccionados.length === 0) {
        showErrorToast('Debe seleccionar al menos un auto para la subasta');
        return;
    }

    // Mostrar indicador de carga
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Creando...';

    const token = localStorage.getItem('token');
    if (!token) {
        showErrorToast('No hay sesión activa');
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        return;
    }

    fetch('/api/subastas/crear', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            titulo: formData.get('titulo'),
            descripcion: formData.get('descripcion'),
            fechaInicio: formData.get('fechaInicio'),
            fechaFin: formData.get('fechaFin'),
            autosIds: autosSeleccionados
        })
    })
    .then(response => {
        if (!response.ok) {
            return response.text().then(text => {
                throw new Error(text || 'Error al crear la subasta');
            });
        }
        return response.json();
    })
    .then(subasta => {
        showSuccessToast('Subasta creada exitosamente');
        bootstrap.Modal.getInstance(document.getElementById('crearSubastaModal')).hide();
        e.target.reset();
        loadActiveAuctions();
    })
    .catch(error => {
        console.error('Error:', error);
        showErrorToast(error.message);
    })
    .finally(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    });
});

// Cargar autos disponibles al abrir el modal de crear subasta
document.getElementById('crearSubastaModal').addEventListener('show.bs.modal', function() {
    loadAutosDisponibles();
});

// Agregar botón para más autos
document.getElementById('agregarAutoBtn').addEventListener('click', function() {
    const container = document.getElementById('autosContainer');
    const newSelectContainer = document.createElement('div');
    newSelectContainer.className = 'auto-select-container mb-2 d-flex';
    newSelectContainer.innerHTML = `
        <select class="form-select auto-select me-2" required>
            <option value="">Seleccione un auto...</option>
        </select>
        <button type="button" class="btn btn-outline-danger btn-sm" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    container.appendChild(newSelectContainer);
    loadAutosDisponibles();
});

// Cargar autos disponibles
function loadAutosDisponibles() {
    const token = localStorage.getItem('token');
    if (!token) {
        console.error('No hay token disponible');
        return;
    }

    fetch('/api/autos/vendedor', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => {
        if (!response.ok) {
            if (response.status === 403) {
                throw new Error('No tiene permisos para ver los autos');
            }
            return response.text().then(text => {
                throw new Error(text || 'Error al cargar los autos disponibles');
            });
        }
        return response.json();
    })
    .then(autos => {
        document.querySelectorAll('.auto-select').forEach(select => {
            const selectedValue = select.value;
            select.innerHTML = '<option value="">Seleccione un auto...</option>';
            if (autos && autos.length > 0) {
                autos.forEach(auto => {
                    if (!auto.vendido) {
                        const option = document.createElement('option');
                        option.value = auto.id;
                        option.textContent = `${auto.marca} ${auto.modelo} (${auto.anio}) - $${auto.precioBase}`;
                        select.appendChild(option);
                    }
                });
                if (selectedValue) {
                    select.value = selectedValue;
                }
            }
        });
    })
    .catch(error => {
        console.error('Error cargando autos:', error);
        showErrorToast(error.message || 'Error al cargar los autos disponibles');
        document.querySelectorAll('.auto-select').forEach(select => {
            select.innerHTML = '<option value="">Error al cargar autos</option>';
        });
    });
}

// Cargar subastas del vendedor
function loadVendedorSubastas() {
    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('/api/subastas/vendedor', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => {
        if (!response.ok) {
            return response.text().then(text => {
                throw new Error(text || 'Error al cargar las subastas');
            });
        }
        return response.json();
    })
    .then(subastas => {
        const subastasList = document.getElementById('misSubastasList');
        if (subastasList) {
            subastasList.innerHTML = '';
            if (subastas && subastas.length > 0) {
                subastas.forEach(subasta => {
                    const card = document.createElement('div');
                    card.className = 'col-md-6 mb-4';
                    card.innerHTML = `
                        <div class="card">
                            <div class="card-body">
                                <h5 class="card-title">${subasta.titulo}</h5>
                                <p class="card-text">${subasta.descripcion}</p>
                                <p>Fecha Inicio: ${new Date(subasta.fechaInicio).toLocaleString()}</p>
                                <p>Fecha Fin: ${new Date(subasta.fechaFin).toLocaleString()}</p>
                                <p>Estado: ${subasta.activa ? 'Activa' : 'Finalizada'}</p>
                            </div>
                        </div>
                    `;
                    subastasList.appendChild(card);
                });
            } else {
                subastasList.innerHTML = '<div class="col-12"><p class="text-muted">No tiene subastas creadas</p></div>';
            }
        }
    })
    .catch(error => {
        console.error('Error cargando subastas del vendedor:', error);
        showErrorToast(error.message || 'Error al cargar las subastas del vendedor');
    });
}

// Función para crear tarjeta de auto
function createAutoCard(auto) {
    const card = document.createElement('div');
    card.className = 'col-md-4 mb-4';
    
    let estadoBtn = '';
    if (auto.vendido) {
        estadoBtn = '<span class="badge bg-success">Vendido</span>';
    } else if (auto.enSubasta) {
        estadoBtn = '<span class="badge bg-warning">En Subasta</span>';
    } else {
        estadoBtn = '<span class="badge bg-primary">Disponible</span>';
    }
    
    card.innerHTML = `
        <div class="card h-100">
            <div class="card-body">
                <h5 class="card-title">${auto.marca} ${auto.modelo}</h5>
                <p class="card-text">
                    <strong>Año:</strong> ${auto.anio}<br>
                    <strong>Precio Base:</strong> $${auto.precioBase.toFixed(2)}<br>
                    <strong>Estado:</strong> ${auto.vendido ? 'Vendido' : (auto.enSubasta ? 'En Subasta' : 'Disponible')}
                </p>
                <p class="card-text">${auto.descripcion}</p>
                ${estadoBtn}
            </div>
        </div>
    `;
    
    return card;
}

// Función para agregar auto a nueva subasta
function agregarAutoANuevaSubasta(autoId) {
    const modal = new bootstrap.Modal(document.getElementById('crearSubastaModal'));
    const autoSelect = document.querySelector('.auto-select');
    if (autoSelect) {
        autoSelect.value = autoId;
    }
    modal.show();
}

// Cargar autos del vendedor
function loadVendedorAutos() {
    const token = localStorage.getItem('token');
    if (!token) {
        console.error('No hay token disponible');
        return;
    }

    fetch('/api/autos/vendedor', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => {
        if (!response.ok) {
            if (response.status === 403) {
                throw new Error('No tiene permisos para ver los autos');
            }
            return response.text().then(text => {
                throw new Error(text || 'Error al cargar los autos');
            });
        }
        return response.json();
    })
    .then(autos => {
        const autosList = document.getElementById('misAutosList');
        if (autosList) {
            autosList.innerHTML = '';
            if (autos && autos.length > 0) {
                autos.forEach(auto => {
                    const card = createAutoCard(auto);
                    autosList.appendChild(card);
                });
            } else {
                autosList.innerHTML = '<div class="col-12"><p class="text-muted">No tiene autos registrados</p></div>';
            }
        }
    })
    .catch(error => {
        console.error('Error cargando autos del vendedor:', error);
        showErrorToast(error.message || 'Error al cargar los autos');
        const autosList = document.getElementById('misAutosList');
        if (autosList) {
            autosList.innerHTML = '<div class="col-12"><p class="text-danger">Error al cargar los autos</p></div>';
        }
    });
}

// Verificar estado de subastas periódicamente
function checkAuctionsStatus() {
    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('/api/subastas/activas', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => response.json())
    .then(subastas => {
        subastas.forEach(subasta => {
            const fechaFin = new Date(subasta.fechaFin);
            if (fechaFin <= new Date() && subasta.activa) {
                fetch(`/api/subastas/${subasta.id}/finalizar`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                })
                .then(() => {
                    loadActiveAuctions();
                    loadVendedorSubastas();
                    loadVendedorAutos();
                })
                .catch(error => console.error('Error finalizando subasta:', error));
            }
        });
    })
    .catch(error => console.error('Error verificando estado de subastas:', error));
}

// Iniciar verificación periódica de subastas
setInterval(checkAuctionsStatus, 60000); // Verificar cada minuto

// Funciones de administración
async function toggleUserStatus(userId, isActive) {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showErrorToast('No hay sesión activa');
            return;
        }

        const endpoint = isActive ? 'activar' : 'desactivar';
        const response = await fetch(`/api/admin/usuarios/${userId}/${endpoint}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }

        const usuario = await response.json();
        showSuccessToast(`Usuario ${isActive ? 'activado' : 'desactivado'} correctamente`);
        
        // Actualizar la UI inmediatamente
        const row = document.querySelector(`tr[data-user-id="${userId}"]`);
        if (row) {
            const statusCell = row.querySelector('.status-cell');
            const actionButton = row.querySelector('.toggle-status-btn');
            
            if (statusCell) {
                statusCell.textContent = isActive ? 'Activo' : 'Inactivo';
                statusCell.className = `status-cell ${isActive ? 'text-success' : 'text-danger'}`;
            }
            
            if (actionButton) {
                actionButton.textContent = isActive ? 'Desactivar' : 'Activar';
                actionButton.onclick = () => toggleUserStatus(userId, !isActive);
            }
        }

        // Recargar la lista de usuarios para asegurar que todo esté actualizado
        await loadUsersList();

    } catch (error) {
        console.error('Error:', error);
        showErrorToast(error.message || 'Error al cambiar el estado del usuario');
    }
}

function loadUsersList() {
    const token = localStorage.getItem('token');
    if (!token) {
        showErrorToast('No hay sesión activa');
        return;
    }

    fetch('/api/admin/usuarios', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    })
    .then(async response => {
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || 'Error al cargar la lista de usuarios');
        }
        return response.json();
    })
    .then(usuarios => {
        const adminUsersList = document.getElementById('adminUsersList');
        if (!adminUsersList) return;

        adminUsersList.innerHTML = '';
        if (usuarios && usuarios.length > 0) {
            usuarios.forEach(usuario => {
                const isActive = usuario.activo;
                const row = document.createElement('tr');
                row.setAttribute('data-user-id', usuario.id);
                row.innerHTML = `
                    <td>${usuario.username}</td>
                    <td>${usuario.nombre} ${usuario.apellido}</td>
                    <td>${usuario.tipoUsuario}</td>
                    <td class="status-cell ${isActive ? 'text-success' : 'text-danger'}">
                        ${isActive ? 'Activo' : 'Inactivo'}
                    </td>
                    <td>
                        <button class="btn btn-sm ${isActive ? 'btn-danger' : 'btn-success'} toggle-status-btn" 
                                onclick="toggleUserStatus(${usuario.id}, ${!isActive})">
                            ${isActive ? 'Desactivar' : 'Activar'}
                        </button>
                    </td>
                `;
                adminUsersList.appendChild(row);
            });
        } else {
            adminUsersList.innerHTML = '<tr><td colspan="5" class="text-center">No hay usuarios registrados</td></tr>';
        }
    })
    .catch(error => {
        console.error('Error cargando usuarios:', error);
        showErrorToast(error.message || 'Error al cargar la lista de usuarios');
        const adminUsersList = document.getElementById('adminUsersList');
        if (adminUsersList) {
            adminUsersList.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error al cargar la lista de usuarios</td></tr>';
        }
    });
}

function playNotificationSound(type) {
    const audio = new Audio();
    switch(type) {
        case 'success':
            audio.src = '/sounds/success.mp3';
            break;
        case 'notification':
            audio.src = '/sounds/notification.mp3';
            break;
    }
    audio.play().catch(e => console.log('Error reproduciendo sonido:', e));
}

function loadSubastasFinalizadas() {
    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('/api/subastas/admin/finalizadas', {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    })
    .then(async response => {
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Error al cargar subastas finalizadas: ${text}`);
        }
        return response.json();
    })
    .then(subastas => {
        const container = document.getElementById('subastasFinalizadasList');
        container.innerHTML = '';

        if (subastas.length === 0) {
            container.innerHTML = '<div class="col-12"><p class="text-center">No hay subastas finalizadas.</p></div>';
            return;
        }

        subastas.forEach(subasta => {
            const card = document.createElement('div');
            card.className = 'col-md-4 mb-4';
            card.innerHTML = `
                <div class="card h-100">
                    <div class="card-body">
                        <h5 class="card-title">${subasta.titulo}</h5>
                        <p class="card-text">
                            <strong>Descripción:</strong> ${subasta.descripcion}<br>
                            <strong>Fecha Finalización:</strong> ${new Date(subasta.fechaFin).toLocaleString()}<br>
                            <strong>Estado:</strong> ${subasta.finalizada ? 'Finalizada' : 'En proceso'}<br>
                            <strong>Vendedor:</strong> ${subasta.vendedor.username}
                        </p>
                        <div class="mt-3">
                            <h6>Autos en la subasta:</h6>
                            ${subasta.autos.map(autoSubasta => `
                                <div class="mb-2">
                                    <strong>${autoSubasta.auto.marca} ${autoSubasta.auto.modelo}</strong><br>
                                    Precio Final: $${autoSubasta.precioFinal}<br>
                                    Estado: ${autoSubasta.vendido ? 'Vendido' : 'No vendido'}
                                    ${autoSubasta.vendido && autoSubasta.comprador ? 
                                        `<br>Comprador: ${autoSubasta.comprador.username}` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    })
    .catch(error => {
        console.error('Error:', error);
        document.getElementById('subastasFinalizadasList').innerHTML = 
            '<div class="col-12"><p class="text-center text-danger">Error al cargar subastas finalizadas.</p></div>';
    });
}