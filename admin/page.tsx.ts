// Фрагмент кода страницы
const allTenants = await db.select().from(tenants);

// В рендере таблицы:
{allTenants.map((tenant) => {
  const daysLeft = tenant.paidTill 
    ? Math.ceil((new Date(tenant.paidTill).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <tr key={tenant.id}>
      <td>{tenant.name}</td>
      <td className={daysLeft < 7 ? "text-red-500" : "text-green-500"}>
        {daysLeft > 0 ? `${daysLeft} дней` : "Истекла"}
      </td>
      <td>{tenant.paidTill}</td>
    </tr>
  )
})}