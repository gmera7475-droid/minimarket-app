// --- CONFIGURACIÓN DE SUPABASE ---
const SUPABASE_URL = "https://nhziqdmcsbwcptudijaz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oemlxZG1jc2J3Y3B0dWRpamF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MzM3NDIsImV4cCI6MjEwODEwOTc0Mn0.gLgol5mCRsBdg7up_QPKz412CQ82MS67MqrqZ5PYvqs";

// Inicializar cliente de Supabase
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let productsCache = [];
let cart = [];

// --- NAVEGACIÓN ENTRE PESTAÑAS ---
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(`sec-${tabName}`).classList.remove('hidden');
  
  if (tabName === 'inventory') {
    loadInventoryTable();
  } else if (tabName === 'admin') {
    populateProductSelects();
  } else if (tabName === 'dashboard') {
    loadFinancialSummary();
  }
}

// --- CARGAR PRODUCTOS EN EL POS ---
async function loadPOSProducts() {
  const container = document.getElementById('product-list');
  const { data, error } = await db.from('productos').select('*').order('nombre', { ascending: true });

  if (error) {
    container.innerHTML = `<p class="text-red-500 text-sm">Error al cargar productos.</p>`;
    return;
  }

  productsCache = data;
  if (data.length === 0) {
    container.innerHTML = `<p class="text-gray-500 text-sm">No hay productos registrados.</p>`;
    return;
  }

  // Diseño minimalista en cuadrícula compacta
  container.innerHTML = data.map(prod => `
    <div onclick="addToCart('${prod.id_producto}')" class="bg-white border border-gray-200 p-3 rounded-lg cursor-pointer hover:border-blue-500 hover:shadow-sm transition flex flex-col justify-between group">
      <div>
        <div class="flex justify-between items-start">
          <h4 class="font-medium text-gray-800 text-sm group-hover:text-blue-600 truncate">${prod.nombre}</h4>
          <span class="text-xs text-gray-400 ml-1">${prod.stock_actual} disp.</span>
        </div>
      </div>
      <div class="mt-2 text-right">
        <span class="text-sm font-bold text-gray-900">$${Number(prod.precio_venta).toFixed(2)}</span>
      </div>
    </div>
  `).join('');
}

// --- LÓGICA DEL CARRITO ---
function addToCart(id) {
  const product = productsCache.find(p => p.id_producto === id);
  if (!product) return;

  const existing = cart.find(item => item.id_producto === id);
  if (existing) {
    if (existing.cantidad < product.stock_actual) {
      existing.cantidad++;
    } else {
      alert("No hay suficiente stock disponible.");
    }
  } else {
    if (product.stock_actual > 0) {
      cart.push({
        id_producto: product.id_producto,
        nombre: product.nombre,
        precio_unitario: product.precio_venta,
        costo_unitario: product.costo_compra,
        cantidad: 1
      });
    } else {
      alert("Producto sin stock.");
    }
  }
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const totalElem = document.getElementById('cart-total');

  if (cart.length === 0) {
    container.innerHTML = `<p class="text-gray-400 text-sm">El carrito está vacío</p>`;
    totalElem.innerText = "$0.00";
    return;
  }

  let total = 0;
  container.innerHTML = cart.map((item, index) => {
    const subtotal = item.precio_unitario * item.cantidad;
    total += subtotal;
    return `
      <div class="flex justify-between items-center text-sm border-b pb-1">
        <div>
          <p class="font-semibold text-gray-800">${item.nombre}</p>
          <p class="text-xs text-gray-500">${item.cantidad} x $${Number(item.precio_unitario).toFixed(2)}</p>
        </div>
        <div class="flex items-center space-x-2">
          <span class="font-bold">$${subtotal.toFixed(2)}</span>
          <button onclick="removeFromCart(${index})" class="text-red-500 hover:text-red-700 font-bold px-1">×</button>
        </div>
      </div>
    `;
  }).join('');

  totalElem.innerText = `$${total.toFixed(2)}`;
}

function removeFromCart(index) {
  cart.splice(index, 1);
  renderCart();
}

// --- PROCESAR VENTA (COBRO) ---
async function checkout() {
  if (cart.length === 0) {
    alert("El carrito está vacío.");
    return;
  }

  const totalVenta = cart.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0);
  const saleId = 'V-' + Date.now();

  // 1. Registrar Cabecera de Venta
  const { error: saleError } = await db.from('ventas').insert([{
    id_venta: saleId,
    total_venta: totalVenta,
    metodo_pago: 'Efectivo',
    cajero: 'Admin'
  }]);

  if (saleError) {
    alert("Error al registrar la venta: " + saleError.message);
    return;
  }

  // 2. Registrar Detalles de la Venta
  const detailsPayload = cart.map(item => ({
    id_venta: saleId,
    id_producto: item.id_producto,
    precio_unitario: item.precio_unitario,
    cantidad: item.cantidad,
    subtotal: item.precio_unitario * item.cantidad,
    costo_unitario: item.costo_unitario
  }));

  const { error: detailError } = await db.from('detalle_ventas').insert(detailsPayload);

  if (detailError) {
    alert("Error al guardar los detalles de la venta.");
    return;
  }

  // 3. Descontar Stock manualmente en la tabla productos
  for (const item of cart) {
    const prod = productsCache.find(p => p.id_producto === item.id_producto);
    const nuevoStock = prod.stock_actual - item.cantidad;
    await db.from('productos').update({ stock_actual: nuevoStock }).eq('id_producto', item.id_producto);
  }

  alert("¡Venta cobrada y registrada con éxito!");
  cart = [];
  renderCart();
  loadPOSProducts();
}

// --- CARGAR TABLA DE INVENTARIO ---
async function loadInventoryTable() {
  const tbody = document.getElementById('inventory-table-body');
  const { data, error } = await db.from('productos').select('*');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-3 text-red-500">Error al cargar inventario.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(prod => `
    <tr class="border-b hover:bg-gray-50 text-sm">
      <td class="p-3 font-mono text-gray-600">${prod.id_producto}</td>
      <td class="p-3 font-semibold text-gray-800">${prod.nombre}</td>
      <td class="p-3 text-gray-600">${prod.categoria || '-'}</td>
      <td class="p-3">$${Number(prod.costo_compra).toFixed(2)}</td>
      <td class="p-3">$${Number(prod.precio_venta).toFixed(2)}</td>
      <td class="p-3 font-bold">${prod.stock_actual}</td>
      <td class="p-3">
        <span class="px-2 py-1 rounded text-xs font-semibold ${prod.stock_actual <= prod.stock_minimo ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">
          ${prod.stock_actual <= prod.stock_minimo ? '⚠️ Bajo Stock' : 'OK'}
        </span>
      </td>
    </tr>
  `).join('');
}

// --- CARGAR RESUMEN FINANCIERO ---
let financialChartInstance = null;

async function loadFinancialSummary() {
  // 1. Obtener Ingresos Brutos (Ventas)
  const { data: ventas } = await db.from('ventas').select('total_venta');
  const ingresosBrutos = ventas ? ventas.reduce((acc, v) => acc + Number(v.total_venta), 0) : 0;

  // 2. Obtener Costo de Mercancía Vendida (COGS)
  const { data: detalles } = await db.from('detalle_ventas').select('cantidad, costo_unitario');
  const cogs = detalles ? detalles.reduce((acc, d) => acc + (d.cantidad * Number(d.costo_unitario)), 0) : 0;

  // 3. Obtener Gastos Operativos y Mermas
  const { data: gastos } = await db.from('gastos_y_mermas').select('monto_total');
  const totalGastos = gastos ? gastos.reduce((acc, g) => acc + Number(g.monto_total), 0) : 0;

  // 4. Obtener Valor del Inventario
  const { data: productos } = await db.from('productos').select('stock_actual, costo_compra');
  const valorInventario = productos ? productos.reduce((acc, p) => acc + (p.stock_actual * Number(p.costo_compra)), 0) : 0;

  // Cálculos finales de utilidad
  const costosYGastosTotales = cogs + totalGastos;
  const gananciaNeta = ingresosBrutos - costosYGastosTotales;

  // Actualizar KPIs en interfaz
  document.getElementById('kpi-ingresos').innerText = `$${ingresosBrutos.toFixed(2)}`;
  document.getElementById('kpi-costos-gastos').innerText = `$${costosYGastosTotales.toFixed(2)}`;
  document.getElementById('kpi-inventario').innerText = `$${valorInventario.toFixed(2)}`;
  document.getElementById('kpi-ganancia-neta').innerText = `$${gananciaNeta.toFixed(2)}`;

  const badge = document.getElementById('kpi-badge-estado');
  if (gananciaNeta >= 0) {
    badge.className = "px-3 py-1 bg-green-500/30 text-green-100 rounded-full text-xs font-semibold";
    badge.innerText = "📈 Negocio Rentable";
  } else {
    badge.className = "px-3 py-1 bg-red-500/30 text-red-100 rounded-full text-xs font-semibold";
    badge.innerText = "📉 En Pérdida";
  }

  // Renderizar Gráfico de Barras con Chart.js
  const ctx = document.getElementById('financialChart').getContext('2d');
  if (financialChartInstance) {
    financialChartInstance.destroy(); // Destruir gráfico anterior para evitar solapamientos
  }

  financialChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Periodo Actual'],
      datasets: [
        {
          label: 'Ingresos por Ventas',
          data: [ingresosBrutos],
          backgroundColor: 'rgba(59, 130, 246, 0.8)',
          borderRadius: 6
        },
        {
          label: 'Costos y Gastos',
          data: [costosYGastosTotales],
          backgroundColor: 'rgba(239, 68, 68, 0.8)',
          borderRadius: 6
        },
        {
          label: 'Utilidad Neta',
          data: [gananciaNeta],
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
}

// Inicializar cargando productos al abrir la página
window.onload = loadPOSProducts;

// Llenar selectores de productos en los formularios
async function populateProductSelects() {
  const select = document.getElementById('compra-producto');
  if (productsCache.length === 0) {
    const { data } = await db.from('productos').select('*');
    if (data) productsCache = data;
  }
  
  select.innerHTML = '<option value="">Seleccione un producto</option>' + 
    productsCache.map(p => `<option value="${p.id_producto}">${p.nombre} (Stock: ${p.stock_actual})</option>`).join('');
}

// 1. Crear nuevo producto
async function handleCreateProduct(event) {
  event.preventDefault();
  const nuevoProd = {
    id_producto: document.getElementById('prod-id').value.trim(),
    nombre: document.getElementById('prod-nombre').value.trim(),
    costo_compra: parseFloat(document.getElementById('prod-costo').value),
    precio_venta: parseFloat(document.getElementById('prod-precio').value),
    stock_actual: parseInt(document.getElementById('prod-stock').value),
    stock_minimo: parseInt(document.getElementById('prod-minimo').value)
  };

  const { error } = await db.from('productos').insert([nuevoProd]);
  if (error) {
    alert("Error al crear producto: " + error.message);
    return;
  }

  alert("¡Producto registrado con éxito!");
  event.target.reset();
  loadPOSProducts();
}

// 2. Registrar Compra y actualizar stock
async function handleCreatePurchase(event) {
  event.preventDefault();
  const idProducto = document.getElementById('compra-producto').value;
  const proveedor = document.getElementById('compra-proveedor').value;
  const cantidad = parseInt(document.getElementById('compra-cantidad').value);
  const costoUnitario = parseFloat(document.getElementById('compra-costo').value);
  const compraId = 'COM-' + Date.now();

  // Insertar en tabla compras
  const { error: compError } = await db.from('compras').insert([{
    id_compra: compraId,
    id_producto: idProducto,
    proveedor: proveedor,
    cantidad: cantidad,
    costo_unitario: costoUnitario,
    costo_total: cantidad * costoUnitario
  }]);

  if (compError) {
    alert("Error al registrar compra: " + compError.message);
    return;
  }

  // Actualizar stock sumando la cantidad comprada
  const prod = productsCache.find(p => p.id_producto === idProducto);
  if (prod) {
    const nuevoStock = prod.stock_actual + cantidad;
    await db.from('productos').update({ stock_actual: nuevoStock, costo_compra: costoUnitario }).eq('id_producto', idProducto);
  }

  alert("¡Compra registrada y stock actualizado!");
  event.target.reset();
  loadPOSProducts();
  populateProductSelects();
}

// 3. Registrar Gasto Operativo o Merma
async function handleCreateExpense(event) {
  event.preventDefault();
  const tipo = document.getElementById('gasto-tipo').value;
  const concepto = document.getElementById('gasto-concepto').value;
  const monto = parseFloat(document.getElementById('gasto-monto').value);
  const registroId = (tipo === 'Merma' ? 'MER-' : 'GAS-') + Date.now();

  const { error } = await db.from('gastos_y_mermas').insert([{
    id_registro: registroId,
    tipo: tipo,
    concepto: concepto,
    monto_total: monto
  }]);

  if (error) {
    alert("Error al registrar el egreso: " + error.message);
    return;
  }

  alert("¡Egreso registrado correctamente!");
  event.target.reset();
}